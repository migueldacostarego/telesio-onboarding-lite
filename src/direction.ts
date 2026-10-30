import type { Audit } from './audit';
import type { ReadyConfig } from './config';
import { graphFailureProps, sansUpn, type Directory, type OnboardingUser, type SansUpn } from './directory';
import { buildFolderName } from './folder';
import type { Library } from './sharepoint';
import { ServiceError } from './demandes';
import { ensureLicense } from './licence';

export interface DirectionDeps {
  config: ReadyConfig;
  directory: Directory;
  library?: Library;
  audit: Audit;
  /** Attentes entre deux lectures de l'état de licence (traitement par groupe asynchrone). */
  licensePollDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

/** Exécute une étape Graph ; toute erreur devient un 502 qui nomme l'étape (jamais de message brut). */
export async function step<T>(
  deps: DirectionDeps,
  actor: string,
  etape: string,
  cible: string | undefined,
  extra: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    deps.audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape, cible, ...graphFailureProps(err) });
    throw new ServiceError(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape, ...extra });
  }
}

/** Extension du créateur : sans elle, l'auto-approbation ne pourrait pas être tracée (fail closed, 503). */
export function creatorExtensionOf(deps: Pick<DirectionDeps, 'config'>): string {
  const ext = deps.config.creatorExtension;
  if (!ext) throw new ServiceError(503, { error: 'Créateur de la demande non configuré (ENTRA_CREATOR_EXTENSION)' });
  return ext;
}

/** Vrai si la demande a été créée par cette personne (comparaison d'objectId sans tenir compte de la casse). */
export const isCreator = (createur: string | null | undefined, actor: string): boolean =>
  createur != null && createur.toLowerCase() === actor.toLowerCase();

/**
 * Charge le compte et refuse (409) s'il n'est pas dans un statut autorisé.
 * Garde-fou central : refuser supprime un compte, il ne doit jamais viser autre chose qu'un compte
 * d'onboarding encore désactivé.
 */
async function loadForAction(
  deps: DirectionDeps,
  actor: string,
  id: string,
  allowed: readonly string[],
  action: 'valider' | 'refuser' | 'reprendre',
): Promise<OnboardingUser> {
  const creatorExt = creatorExtensionOf(deps);
  const user = await step(deps, actor, 'lecture', id, {}, () =>
    deps.directory.getOnboardingUser(id, deps.config.statusExtension, deps.config.licenseExtension, creatorExt),
  );
  if (!user) {
    deps.audit.track({ action: 'demande.introuvable', actor, outcome: 'refuse', cible: id });
    throw new ServiceError(404, { error: 'Demande introuvable' });
  }
  if (user.accountEnabled || user.statut === null || !allowed.includes(user.statut)) {
    const statut = user.accountEnabled || user.statut === null ? 'inconnu' : user.statut;
    deps.audit.track({ action: 'demande.conflit', actor, outcome: 'refuse', cible: id, statut });
    throw new ServiceError(409, { error: 'Action impossible dans le statut actuel', statut });
  }
  // L'auto-approbation est autorisée, mais tracée (objectIds seulement). Reprendre le dossier n'approuve rien : pas de trace.
  // Une demande sans créateur (antérieure à l'extension) n'est pas concernée.
  if (action !== 'reprendre' && isCreator(user.createur, actor)) {
    deps.audit.track({ action: 'demande.auto_approbation', actor, outcome: 'ok', cible: id, operation: action });
  }
  return user;
}

export async function listDemandes(
  deps: DirectionDeps,
  actor: string,
): Promise<{ demandes: SansUpn[]; tronque: boolean }> {
  const res = await step(deps, actor, 'liste', undefined, {}, () =>
    deps.directory.listByStatut(deps.config.statusExtension, 'EnAttente'),
  );
  deps.audit.track({ action: 'demande.liste', actor, outcome: 'ok', resultats: res.demandes.length, tronque: res.tronque });
  return { demandes: res.demandes.map(sansUpn), tronque: res.tronque };
}

export interface Validation {
  id: string;
  statut: 'Validé';
  /** deja : le compte portait déjà la licence (reprise), aucun ajout au groupe. */
  licence: { deja: boolean };
  dossier: { id: string; url: string | null; cree: boolean };
  /** true : demande déjà Validé, seule la création du dossier a été reprise. */
  reprise: boolean;
}

/**
 * Licence et groupe des arrivants (avant toute écriture de statut), puis EnAttente → Validé, puis dossier SharePoint (idempotent).
 * Aucune licence disponible : 409 et le statut ne change pas.
 * Un compte déjà Validé est accepté : c'est la reprise après un échec SharePoint (le statut reste Validé) ;
 * un compte déjà licencié ne repasse pas par le décompte.
 */
export async function validerDemande(deps: DirectionDeps, actor: string, id: string): Promise<Validation> {
  const { config, directory, audit, library } = deps;
  if (!library) {
    throw new ServiceError(503, { error: 'SharePoint non configuré (SHAREPOINT_SITE_ID, SHAREPOINT_DRIVE_ID)' });
  }
  if (config.licenses.length === 0) throw new ServiceError(503, { error: 'Licences non configurées (LICENSES)' });
  const user = await loadForAction(deps, actor, id, ['EnAttente', 'Validé'], 'valider');
  const reprise = user.statut === 'Validé';

  // Le SKU est celui choisi par RH (extension licenceOnboarding) ; absent ou retiré de la liste : 409, rien n'est écrit.
  const option = config.licenses.find((l) => l.skuId === user.licence);
  if (!option) {
    audit.track({ action: 'licence.non_choisie', actor, outcome: 'refuse', cible: id });
    throw new ServiceError(409, { error: 'Licence non définie ou non proposée pour cette demande', code: 'licence_inconnue' });
  }
  const licence = await ensureLicense(deps, actor, id, option);

  // Groupe des arrivants (cible de l'accès conditionnel qui impose Authenticator) dès la validation, et non à
  // l'activation : l'appartenance a le temps de se répliquer avant le jour J. Sans risque, le compte reste désactivé jusqu'à l'activation.
  // Avant le statut : un échec laisse la demande EnAttente, visible et revalidable par la direction.
  if (config.arrivantsGroupId) {
    const groupId = config.arrivantsGroupId;
    await step(deps, actor, 'groupe_arrivants', id, {}, () => directory.addGroupMember(groupId, id));
    audit.track({ action: 'demande.arrivants_ajout', actor, outcome: 'ok', cible: id, groupe: groupId });
  }

  if (!reprise) {
    await step(deps, actor, 'statut', id, {}, () => directory.setExtension(id, config.statusExtension, 'Validé'));
    audit.track({ action: 'demande.validee', actor, outcome: 'ok', cible: id });
  } else {
    audit.track({ action: 'demande.reprise', actor, outcome: 'ok', cible: id });
  }

  const dossier = await creerDossier(deps, actor, id, user, library);
  return { id, statut: 'Validé', licence, dossier, reprise };
}

/** Crée le dossier SharePoint de la personne (idempotent : un dossier existant est réutilisé). Le compte reste Validé en cas d'échec. */
async function creerDossier(deps: DirectionDeps, actor: string, id: string, user: OnboardingUser, library: Library): Promise<Validation['dossier']> {
  const after = { statut: 'Validé' };
  const name = await step(deps, actor, 'dossier_nom', id, after, async () =>
    buildFolderName(deps.config.sharePoint.folderPattern, {
      nom: user.surname ?? '',
      prenom: user.givenName ?? '',
      id,
    }),
  );
  const folder = await step(deps, actor, 'dossier_sharepoint', id, after, () => library.ensureFolder(name));
  // Ni le nom du dossier (contient le nom de la personne) ni l'URL ne sont tracés.
  deps.audit.track({ action: 'demande.dossier', actor, outcome: 'ok', cible: id, dossier: folder.id, cree: folder.created });
  return { id: folder.id, url: folder.webUrl, cree: folder.created };
}

/**
 * Compte Validé dont le dossier SharePoint manque (échec après la validation, 502) : recrée le dossier seulement. Ni la licence
 * ni le groupe des arrivants ne sont retouchés, le statut non plus. Réservé à la direction (droit approuver) ; comme `valider`,
 * 409 pour un autre statut. Idempotent : un dossier déjà là est réutilisé.
 */
export async function reprendreDossier(deps: DirectionDeps, actor: string, id: string): Promise<{ id: string; statut: 'Validé'; dossier: Validation['dossier'] }> {
  if (!deps.library) {
    throw new ServiceError(503, { error: 'SharePoint non configuré (SHAREPOINT_SITE_ID, SHAREPOINT_DRIVE_ID)' });
  }
  const user = await loadForAction(deps, actor, id, ['Validé'], 'reprendre');
  const dossier = await creerDossier(deps, actor, id, user, deps.library);
  deps.audit.track({ action: 'demande.reprise_dossier', actor, outcome: 'ok', cible: id });
  return { id, statut: 'Validé', dossier };
}

/** Trace le refus (longueur du motif seulement), puis supprime le compte (corbeille Entra, 30 jours). */
export async function refuserDemande(
  deps: DirectionDeps,
  actor: string,
  id: string,
  motif: string,
): Promise<{ id: string; supprime: true; recuperableJours: 30 }> {
  await loadForAction(deps, actor, id, ['EnAttente'], 'refuser');
  deps.audit.track({ action: 'demande.refusee', actor, outcome: 'ok', cible: id, motifLongueur: motif.length });
  await step(deps, actor, 'suppression_compte', id, {}, () => deps.directory.deleteUser(id));
  deps.audit.track({ action: 'demande.compte_supprime', actor, outcome: 'ok', cible: id });
  return { id, supprime: true, recuperableJours: 30 };
}
