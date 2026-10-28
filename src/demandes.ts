import { randomInt } from 'node:crypto';
import type { Audit } from './audit';
import type { ReadyConfig } from './config';
import { DirectoryError, graphFailureProps, type Directory } from './directory';
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

function randomPassword(length = 32): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%&*+-=?@_'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)] as string);
  while (chars.length < length) chars.push(all[randomInt(all.length)] as string);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}

export interface DemandeCreee {
  id: string;
  userPrincipalName: string;
  statut: 'EnAttente';
  /** manager_non_affecte : la demande existe (en attente), mais le manager reste à poser dans Entra. */
  avertissement?: 'manager_non_affecte';
}

/**
 * Crée le compte désactivé avec statutOnboarding=EnAttente et le choix de licence dans le même POST (aucun compte
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

  try {
    // Avant toute écriture : la licence choisie doit encore avoir une unité libre (la réservation se fait à la validation).
    step = 'licence_disponibilite';
    const units = (await directory.listSkuAvailability()).get(input.licence);
    if (!units || units.enabled - units.consumed <= 0) {
      audit.track({ action: 'licence.indisponible', actor, outcome: 'refuse', sku: input.licence, phase: 'demande' });
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
    let upn = '';
    let attempt = 0;
    for (let n = 1; n <= MAX_UPN_ATTEMPTS && !targetId; n++) {
      const candidate = upnCandidate(base, config.upnDomain, n);
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
          usageLocation: USAGE_LOCATION,
          passwordProfile: { password: randomPassword(), forceChangePasswordNextSignIn: true },
        }, {
          [config.licenseExtension as string]: input.licence,
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
    if (!targetId) {
      audit.track({ action: 'demande.upn_indisponible', actor, outcome: 'erreur', tentatives: MAX_UPN_ATTEMPTS });
      throw new ServiceError(409, { error: 'Aucun identifiant disponible pour ce nom' });
    }
    audit.track({ action: 'demande.compte_cree', actor, outcome: 'ok', cible: targetId, suffixe: attempt, statut: 'EnAttente', sku: input.licence });

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
