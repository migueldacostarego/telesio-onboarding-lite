import type { Audit } from './audit';
import type { ReadyConfig } from './config';
import { DirectoryError, graphFailureProps, type Directory } from './directory';
import { randomPassword } from './password';
import { upnBase, upnCandidate } from './upn';
import type { DemandeInput } from './validation';

export interface DemandeDeps {
  config: ReadyConfig;
  directory: Directory;
  audit: Audit;
  /** Délais entre les tentatives de PUT manager (réplication Entra juste après la création). */
  managerRetryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? body.message));
  }
}

/** Pays d'usage posé à la création : Entra n'attribue aucune licence (par groupe) sans usageLocation. */
export const USAGE_LOCATION = 'FR';
const MAX_UPN_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAYS = [500, 1500, 3000, 5000];

export interface DemandeCreee {
  id: string;
  userPrincipalName: string;
  statut: 'EnAttente';
  /** manager_non_affecte : la demande existe (en attente), mais le manager reste à poser dans Entra. */
  avertissement?: 'manager_non_affecte';
}

/**
 * Crée le compte désactivé avec statutOnboarding=EnAttente, le type de contrat (employeeType), la licence qui en découle
 * (LICENCES_PAR_TYPE) et l'objectId du créateur dans le même POST (aucun compte
 * fantôme sans statut), puis affecte le manager. Un manager impossible à poser n'annule pas la demande, déjà visible
 * par la direction : la réponse le signale (avertissement) plutôt qu'un 502 qui pousserait RH à recréer un doublon.
 * Le mot de passe est aléatoire, jamais stocké, jamais loggé.
 */
export async function createDemande(
  deps: DemandeDeps,
  actor: string,
  input: DemandeInput,
): Promise<DemandeCreee> {
  const { config, directory, audit } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = deps.managerRetryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  let step = 'manager_verification';
  let targetId: string | undefined;
  // Avant toute écriture : sans l'extension du créateur, l'auto-approbation ne pourrait pas être tracée.
  const creatorExt = config.creatorExtension;
  if (!creatorExt) throw new ServiceError(503, { error: 'Créateur de la demande non configuré (ENTRA_CREATOR_EXTENSION)' });
  // La licence découle du type de contrat : elle n'est plus choisie, mais l'extension licenceOnboarding reste écrite (la validation la lit).
  if (!config.licenseByType) throw new ServiceError(503, { error: 'Licences par type de contrat non configurées (LICENCES_PAR_TYPE)' });
  const licence = config.licenseByType[input.typeContrat];
  if (!licence) {
    // Type sans licence prévue (par exemple Contractor tant que Business Basic n'est pas acheté) : même refus qu'une licence épuisée, avant toute lecture ou écriture.
    audit.track({ action: 'licence.indisponible', actor, outcome: 'refuse', typeContrat: input.typeContrat, raison: 'non_prevue', phase: 'demande' });
    throw new ServiceError(409, { error: 'Aucune licence disponible pour ce type de contrat', code: 'licence_indisponible' });
  }

  try {
    // Avant toute écriture : la licence choisie doit encore avoir une unité libre (la réservation se fait à la validation).
    step = 'licence_disponibilite';
    const units = (await directory.listSkuAvailability()).get(licence);
    if (!units || units.enabled - units.consumed <= 0) {
      audit.track({ action: 'licence.indisponible', actor, outcome: 'refuse', sku: licence, typeContrat: input.typeContrat, phase: 'demande' });
      throw new ServiceError(409, { error: 'Aucune licence disponible', code: 'licence_indisponible' });
    }

    step = 'manager_verification';
    const manager = await directory.getUser(input.managerId);
    if (!manager || !manager.accountEnabled) {
      const details = { managerId: manager ? 'compte désactivé' : 'introuvable' };
      audit.track({ action: 'demande.rejetee', actor, outcome: 'refuse', champs: 'managerId' });
      throw new ServiceError(400, { error: 'Entrée invalide', details });
    }

    step = 'upn_attribution';
    const base = upnBase(input.prenom, input.nom);
    // Adresse choisie par RH : une seule tentative, jamais de suffixe ajouté en silence (l'adresse est celle que la personne recevra).
    const explicite = input.email;
    let upn = '';
    let attempt = 0;
    for (let n = 1; n <= (explicite ? 1 : MAX_UPN_ATTEMPTS) && !targetId; n++) {
      const candidate = explicite ?? upnCandidate(base, config.upnDomain, n);
      if (await directory.upnTaken(candidate)) continue;
      step = 'compte_creation';
      try {
        targetId = await directory.createUser({
          accountEnabled: false,
          displayName: `${input.prenom} ${input.nom}`,
          givenName: input.prenom,
          surname: input.nom,
          userPrincipalName: candidate,
          mailNickname: candidate.split('@')[0] as string,
          employeeHireDate: `${input.dateArrivee}T00:00:00Z`,
          jobTitle: input.poste,
          department: input.service,
          employeeType: input.typeContrat,
          usageLocation: USAGE_LOCATION,
          passwordProfile: { password: randomPassword(), forceChangePasswordNextSignIn: true },
        }, {
          [config.licenseExtension as string]: licence,
          // objectId de la personne qui saisit la demande : elle ne pourra ni la valider ni la refuser.
          [creatorExt]: actor,
          [config.statusExtension]: 'EnAttente',
        });
        upn = candidate;
        attempt = n;
      } catch (err) {
        // Course : l'UPN a été pris entre la vérification et la création.
        if (!(err instanceof DirectoryError && err.kind === 'conflict')) throw err;
      }
      step = 'upn_attribution';
    }
    if (!targetId && explicite) {
      audit.track({ action: 'demande.email_pris', actor, outcome: 'refuse' });
      throw new ServiceError(409, { error: 'Cette adresse est déjà utilisée', code: 'email_pris' });
    }
    if (!targetId) {
      audit.track({ action: 'demande.upn_indisponible', actor, outcome: 'erreur', tentatives: MAX_UPN_ATTEMPTS });
      throw new ServiceError(409, { error: 'Aucun identifiant disponible pour ce nom' });
    }
    audit.track({ action: 'demande.compte_cree', actor, outcome: 'ok', cible: targetId, suffixe: attempt, statut: 'EnAttente', sku: licence, typeContrat: input.typeContrat });

    step = 'manager_affectation';
    try {
      await assignManager(directory, targetId, input.managerId, delays, sleep);
    } catch (err) {
      audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape: step, cible: targetId, ...graphFailureProps(err) });
      return { id: targetId, userPrincipalName: upn, statut: 'EnAttente', avertissement: 'manager_non_affecte' };
    }
    audit.track({ action: 'demande.manager_affecte', actor, outcome: 'ok', cible: targetId });
    return { id: targetId, userPrincipalName: upn, statut: 'EnAttente' };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape: step, cible: targetId, ...graphFailureProps(err) });
    throw new ServiceError(502, {
      error: 'Le service d’annuaire a échoué ; la demande n’a pas abouti',
      etape: step,
      ...(targetId ? { id: targetId } : {}),
    });
  }
}

/** PUT manager, réessayé tant que le compte tout juste créé n'est pas répliqué (404). */
async function assignManager(
  directory: Directory,
  userId: string,
  managerId: string,
  delays: number[],
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await directory.setManager(userId, managerId);
      return;
    } catch (err) {
      if (err instanceof DirectoryError && err.kind === 'notFound' && i < delays.length) {
        await sleep(delays[i] as number);
        continue;
      }
      throw err;
    }
  }
}
