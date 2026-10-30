import { todayIn } from './dates';
import { ServiceError } from './demandes';
import { step, type DirectionDeps } from './direction';
import { sansUpn, type OnboardingUser, type SansUpn } from './directory';
import { temporaryPassword } from './password';
import type { MotifRegeneration } from './validation';

export type ActivationDeps = Pick<DirectionDeps, 'config' | 'directory' | 'audit'>;

/** Parallélisme des lectures Graph de contrôle d'onboarding (deux appels par compte Actif). */
const INSPECT_CONCURRENCY = 5;

export interface OnboardingState {
  /** lastPasswordChangeDateTime postérieur à la date d'activation. */
  motDePasse: boolean;
  /** Au moins une méthode Microsoft Authenticator inscrite. */
  authenticator: boolean;
  /** Les deux : l'onboarding est terminé (la finalisation passe par POST /terminer). */
  termine: boolean;
}

export interface ActivationItem extends SansUpn {
  statut: 'Validé' | 'Actif';
  /** activer : jour J atteint ; attendre : arrivée dans le futur ; regenerer : compte Actif, nouveau mot de passe temporaire (avec motif). */
  action: 'activer' | 'attendre' | 'regenerer';
  /** Comptes Actif seulement ; { verification: 'echec' } si la lecture Graph a échoué pour ce compte. */
  onboarding?: OnboardingState | { verification: 'echec' };
}

/** Exécute fn sur chaque élément, au plus `limit` à la fois, en gardant l'ordre. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

/** Groupe des arrivants et extension de la date d'activation : sans eux, les routes d'activation répondent 503. */
export function activationConfig(deps: ActivationDeps): { groupId: string; activationExt: string } {
  const { arrivantsGroupId, activationExtension } = deps.config;
  if (!arrivantsGroupId || !activationExtension) {
    throw new ServiceError(503, { error: 'Activation non configurée (ARRIVANTS_GROUP_ID, ENTRA_ACTIVATION_EXTENSION)' });
  }
  return { groupId: arrivantsGroupId, activationExt: activationExtension };
}

/**
 * La remise du mot de passe temporaire met elle-même à jour lastPasswordChangeDateTime, quelques secondes après la date
 * d'activation écrite juste avant. Seul un changement postérieur à cette marge compte comme le changement de l'arrivant.
 */
export const MARGE_REMISE_MS = 60_000;

/**
 * Ajoute l'état d'onboarding à chaque compte Actif. Un échec de lecture pour un compte (déjà tracé par step)
 * donne { verification: 'echec' } pour ce compte seulement : il ne fait pas échouer toute la liste.
 */
export async function inspectActifs<T extends { id: string }>(
  deps: ActivationDeps,
  actor: string,
  demandes: T[],
): Promise<Array<T & { onboarding: OnboardingState | { verification: 'echec' } }>> {
  return mapLimit(demandes, INSPECT_CONCURRENCY, async (d) => ({
    ...d,
    onboarding: await inspectOnboarding(deps, actor, d.id).catch(() => ({ verification: 'echec' as const })),
  }));
}

/**
 * Comptes Validé, et tous les Actif tant que l'onboarding n'est pas Terminé (avec l'état du mot de passe et d'Authenticator).
 * Lecture seule : les transitions (Terminé) passent par POST /terminer, jamais par une liste.
 */
export async function listActivations(
  deps: ActivationDeps,
  actor: string,
  now: Date,
): Promise<{ demandes: ActivationItem[]; tronque: boolean }> {
  const { config, directory, audit } = deps;
  activationConfig(deps);
  const today = todayIn(config.timeZone, now);
  const [valides, actifs] = await step(deps, actor, 'liste', undefined, {}, () =>
    Promise.all([directory.listByStatut(config.statusExtension, 'Validé'), directory.listByStatut(config.statusExtension, 'Actif')]),
  );
  const suivis = (await inspectActifs(deps, actor, actifs.demandes.map(sansUpn))).map((d) => ({
    ...d,
    statut: 'Actif' as const,
    action: 'regenerer' as const,
  }));
  const demandes: ActivationItem[] = [
    ...valides.demandes.map(sansUpn).map((d) => ({
      ...d,
      statut: 'Validé' as const,
      action: d.dateArrivee !== null && d.dateArrivee <= today ? ('activer' as const) : ('attendre' as const),
    })),
    ...suivis,
  ];
  audit.track({ action: 'activation.liste', actor, outcome: 'ok', resultats: demandes.length });
  return { demandes, tronque: valides.tronque || actifs.tronque };
}

/**
 * Mot de passe changé par l'arrivant après la dernière remise (date d'activation + MARGE_REMISE_MS) ET Authenticator inscrit.
 * Compte activé avant l'extension d'activation : repli sur la date de création du compte.
 */
export async function inspectOnboarding(deps: ActivationDeps, actor: string, id: string): Promise<OnboardingState> {
  const { activationExt } = activationConfig(deps);
  const { directory } = deps;
  const [progress, authenticator] = await Promise.all([
    step(deps, actor, 'onboarding_lecture', id, {}, () => directory.getOnboardingProgress(id, activationExt)),
    step(deps, actor, 'onboarding_authenticator', id, {}, () => directory.hasAuthenticator(id)),
  ]);
  // Les formats diffèrent (millisecondes, décalage) : comparaison numérique, jamais de chaînes.
  const reference = Date.parse(progress.activation ?? progress.createdDateTime ?? '');
  const dernier = Date.parse(progress.lastPasswordChange ?? '');
  const motDePasse = Number.isFinite(reference) && Number.isFinite(dernier) && dernier > reference + MARGE_REMISE_MS;
  return { motDePasse, authenticator, termine: motDePasse && authenticator };
}

export interface Activation {
  id: string;
  statut: 'Actif';
  /** true : nouveau mot de passe temporaire sur un compte déjà actif (« Régénérer »). */
  regeneration: boolean;
  /** Visible une seule fois : à remettre en main propre, jamais tracé ni mis en cache. Changement imposé à la 1re connexion. */
  motDePasseTemporaire: string;
}

async function loadUser(deps: ActivationDeps, actor: string, id: string): Promise<OnboardingUser> {
  const { config, directory, audit } = deps;
  const user = await step(deps, actor, 'lecture', id, {}, () => directory.getOnboardingUser(id, config.statusExtension));
  if (!user) {
    audit.track({ action: 'demande.introuvable', actor, outcome: 'refuse', cible: id });
    throw new ServiceError(404, { error: 'Demande introuvable' });
  }
  return user;
}

function conflict(deps: ActivationDeps, actor: string, user: OnboardingUser, id: string, raison: string, extra: Record<string, unknown> = {}): never {
  deps.audit.track({ action: 'activation.conflit', actor, outcome: 'refuse', cible: id, statut: user.statut ?? 'inconnu', raison });
  throw new ServiceError(409, { error: 'Activation impossible', raison, ...extra });
}

/**
 * Date de remise (référence de « mot de passe changé par l'arrivant »), écrite AVANT la réinitialisation : la date que
 * cette dernière pose (lastPasswordChangeDateTime) tombe donc après la référence, mais dans la marge MARGE_REMISE_MS.
 * Puis mot de passe temporaire, changement imposé à la première connexion. Il n'est ni tracé ni conservé.
 */
async function issuePassword(deps: ActivationDeps, actor: string, id: string, now: Date, activationExt: string, fail: Record<string, unknown>) {
  const { directory, audit } = deps;
  await step(deps, actor, 'activation_date', id, fail, () => directory.setExtension(id, activationExt, now.toISOString()));
  const motDePasseTemporaire = temporaryPassword();
  await step(deps, actor, 'mot_de_passe', id, fail, () => directory.resetPassword(id, motDePasseTemporaire));
  audit.track({ action: 'demande.mdp_temporaire', actor, outcome: 'ok', cible: id });
  return motDePasseTemporaire;
}

/**
 * Validé, jour J atteint : compte activé, groupe des arrivants (déjà posé à la validation, rejoué sans effet ; cible de
 * l'accès conditionnel qui impose Authenticator), mot de passe temporaire, puis statut Actif.
 * Rejouable : après un échec en cours de route le compte reste Validé, et un nouvel « Activer » refait tout
 * (le mot de passe éventuellement posé, jamais affiché, est remplacé).
 */
export async function activerDemande(deps: ActivationDeps, actor: string, id: string, now: Date): Promise<Activation> {
  const { config, directory, audit } = deps;
  const { groupId, activationExt } = activationConfig(deps);
  const user = await loadUser(deps, actor, id);
  const refuse = (raison: string) => conflict(deps, actor, user, id, raison);

  if (user.statut === 'Terminé') refuse('onboarding_termine');
  if (user.statut === 'Actif') refuse('deja_actif');
  if (user.statut !== 'Validé') refuse('statut');
  if (user.dateArrivee === null) refuse('date_arrivee_absente');
  if ((user.dateArrivee as string) > todayIn(config.timeZone, now)) refuse('date_arrivee_future');

  const fail = { statut: user.statut as string };
  if (!user.accountEnabled) {
    await step(deps, actor, 'activation_compte', id, fail, () => directory.setAccountEnabled(id, true));
    audit.track({ action: 'demande.compte_active', actor, outcome: 'ok', cible: id });
  }
  await step(deps, actor, 'groupe_arrivants', id, fail, () => directory.addGroupMember(groupId, id));
  audit.track({ action: 'demande.arrivants_ajout', actor, outcome: 'ok', cible: id, groupe: groupId });

  const motDePasseTemporaire = await issuePassword(deps, actor, id, now, activationExt, fail);
  // Échec ici : 502 sans mot de passe dans la réponse ; le compte reste Validé et RH clique à nouveau sur « Activer ».
  await step(deps, actor, 'statut', id, fail, () => directory.setExtension(id, config.statusExtension, 'Actif'));
  audit.track({ action: 'demande.activee', actor, outcome: 'ok', cible: id });
  return { id, statut: 'Actif', regeneration: false, motDePasseTemporaire };
}

/**
 * Nouveau mot de passe temporaire par RH (perdu, refusé), avec un motif (code fixe) tracé. Comptes Actif seulement ;
 * interdit une fois l'onboarding Terminé. Remplace aussi un mot de passe déjà choisi par l'arrivant : il devra le
 * changer de nouveau, et la référence de « mot de passe changé » repart de cette remise.
 */
export async function regenererMotDePasse(deps: ActivationDeps, actor: string, id: string, motif: MotifRegeneration, now: Date): Promise<Activation> {
  const { directory, audit } = deps;
  const { groupId, activationExt } = activationConfig(deps);
  const user = await loadUser(deps, actor, id);
  const refuse = (raison: string) => conflict(deps, actor, user, id, raison);

  if (user.statut === 'Terminé') refuse('onboarding_termine');
  if (user.statut !== 'Actif') refuse('statut');
  if (!user.accountEnabled) refuse('compte_desactive');

  const fail = { statut: 'Actif' };
  await step(deps, actor, 'groupe_arrivants', id, fail, () => directory.addGroupMember(groupId, id));
  const motDePasseTemporaire = await issuePassword(deps, actor, id, now, activationExt, fail);
  audit.track({ action: 'demande.mdp_regenere', actor, outcome: 'ok', cible: id, motif });
  return { id, statut: 'Actif', regeneration: true, motDePasseTemporaire };
}

export interface Termine {
  id: string;
  statut: 'Terminé';
  /** true : le compte était déjà Terminé (appel répété). */
  deja: boolean;
}

/**
 * Actif et onboarding complet (revérifié ici, jamais cru sur parole) : retrait du groupe des arrivants (fin de
 * l'accès conditionnel propre aux arrivants), puis statut Terminé en dernier. Rejouable : un échec en cours de route
 * laisse le compte Actif, et la reprise ne retire le compte du groupe que s'il en est encore membre.
 */
export async function terminerOnboarding(deps: ActivationDeps, actor: string, id: string): Promise<Termine> {
  const { config, directory, audit } = deps;
  const { groupId } = activationConfig(deps);
  const user = await loadUser(deps, actor, id);
  if (user.statut === 'Terminé') return { id, statut: 'Terminé', deja: true };
  if (user.statut !== 'Actif') conflict(deps, actor, user, id, 'statut');

  const etat = await inspectOnboarding(deps, actor, id);
  if (!etat.termine) {
    conflict(deps, actor, user, id, 'onboarding_non_termine', { motDePasse: etat.motDePasse, authenticator: etat.authenticator });
  }

  const fail = { statut: 'Actif' };
  // Retirer un non-membre échoue en 400 chez Graph : on ne retire que si le compte est encore dans le groupe.
  const retire = await step(deps, actor, 'groupe_retrait_arrivants', id, fail, async () => {
    if (!(await directory.isMemberOfGroup(id, groupId))) return false;
    await directory.removeGroupMember(groupId, id);
    return true;
  });
  if (retire) audit.track({ action: 'onboarding.arrivants_retrait', actor, outcome: 'ok', cible: id, groupe: groupId });

  await step(deps, actor, 'statut', id, fail, () => directory.setExtension(id, config.statusExtension, 'Terminé'));
  audit.track({ action: 'onboarding.termine', actor, outcome: 'ok', cible: id });
  return { id, statut: 'Terminé', deja: false };
}
