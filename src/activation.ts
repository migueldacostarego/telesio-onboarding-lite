import { todayIn } from './dates';
import { ServiceError } from './demandes';
import { step, type DirectionDeps } from './direction';
import { DirectoryError, type OnboardingUser, type PendingDemande, type TapInfo, type TapResult } from './directory';
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

export interface ActivationItem extends PendingDemande {
  statut: 'Validé' | 'Actif';
  /** activer : jour J atteint ; attendre : arrivée dans le futur ; regenerer : compte Actif, TAP à refaire (avec motif). */
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
function activationConfig(deps: ActivationDeps): { groupId: string; activationExt: string } {
  const { arrivantsGroupId, activationExtension } = deps.config;
  if (!arrivantsGroupId || !activationExtension) {
    throw new ServiceError(503, { error: 'Activation non configurée (ARRIVANTS_GROUP_ID, ENTRA_ACTIVATION_EXTENSION)' });
  }
  return { groupId: arrivantsGroupId, activationExt: activationExtension };
}

/** Valide : utilisable maintenant, ou pas encore commencé (startDateTime dans le futur). Expired et OneTimeUsed ne le sont pas. */
export const tapValide = (t: TapInfo): boolean => t.isUsable || t.methodUsabilityReason === 'NotYetValid';

const tapExpireA = (startDateTime: string | null, lifetimeInMinutes: number | null): string | null => {
  if (!startDateTime || lifetimeInMinutes === null) return null;
  const start = Date.parse(startDateTime);
  return Number.isFinite(start) ? new Date(start + lifetimeInMinutes * 60_000).toISOString() : null;
};

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
  // Un échec de lecture pour un compte (déjà tracé par step) ne fait pas échouer toute la liste.
  const suivis = await mapLimit(actifs.demandes, INSPECT_CONCURRENCY, async (d) => ({
    ...d,
    statut: 'Actif' as const,
    action: 'regenerer' as const,
    onboarding: await inspectOnboarding(deps, actor, d.id).catch(() => ({ verification: 'echec' as const })),
  }));
  const demandes: ActivationItem[] = [
    ...valides.demandes.map((d) => ({
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
 * Mot de passe changé après l'activation (l'initial, aléatoire, date de la création du compte) ET Authenticator inscrit.
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
  const motDePasse = Number.isFinite(reference) && Number.isFinite(dernier) && dernier > reference;
  return { motDePasse, authenticator, termine: motDePasse && authenticator };
}

export interface Activation {
  id: string;
  statut: 'Actif';
  /** true : TAP recréé sur un compte déjà activé (« Régénérer », ou reprise d'une activation interrompue). */
  regeneration: boolean;
  /** Visible une seule fois : à remettre en main propre, jamais tracé ni mis en cache. */
  temporaryAccessPass: string;
  lifetimeInMinutes: number;
  startDateTime: string;
  /** Fin de validité : début + durée. */
  expireA: string | null;
  isUsableOnce: boolean;
  /** Délai avant que le TAP soit utilisable (« utilisable dans N minutes »). */
  utilisableDansMinutes: number;
  /** Fuseau d'affichage des heures (TZ_METIER). */
  fuseau: string;
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
 * Ordre fixe, sans deviner la raison d'un refus d'Entra (un seul TAP autorisé par compte) : les TAP existants sont
 * supprimés, puis le nouveau est créé. Si la création échoue ensuite, le compte n'a plus de TAP : la réponse 502
 * le dit (`tap: 'aucun'`) et RH réessaie. À l'activation, un TAP encore valide a déjà été refusé (409) en amont :
 * seuls des TAP expirés ou consommés sont supprimés ici.
 */
async function issueTap(deps: ActivationDeps, actor: string, id: string, now: Date, fail: Record<string, unknown>) {
  const { config, directory, audit } = deps;
  const existants = await step(deps, actor, 'tap_lecture', id, fail, () => directory.listTaps(id));
  let removed = 0;
  if (existants.length > 0) {
    removed = await step(deps, actor, 'tap_suppression', id, fail, async () => {
      for (const t of existants) {
        try {
          await directory.deleteTap(id, t.id);
        } catch (err) {
          // Déjà supprimé (ou remplacé) côté Entra : rien à faire.
          if (err instanceof DirectoryError && err.kind === 'notFound') continue;
          throw err;
        }
      }
      return existants.length;
    });
    audit.track({ action: 'demande.tap_supprime', actor, outcome: 'ok', cible: id, nombre: removed });
  }
  const debut = new Date(now.getTime() + config.tapStartDelayMinutes * 60_000).toISOString();
  const request = { lifetimeInMinutes: config.tapLifetimeMinutes, startDateTime: debut };
  const tap: TapResult = await step(deps, actor, 'tap_creation', id, { ...fail, ...(removed > 0 ? { tap: 'aucun' } : {}) }, () =>
    directory.createTap(id, request),
  );

  // Jamais la valeur du TAP : seulement qu'il a été créé, pour quelle durée et à partir de quand.
  audit.track({
    action: 'demande.tap_cree',
    actor,
    outcome: 'ok',
    cible: id,
    dureeMinutes: tap.lifetimeInMinutes,
    debutDansMinutes: config.tapStartDelayMinutes,
    usageUnique: tap.isUsableOnce,
  });
  const startDateTime = tap.startDateTime ?? debut;
  return {
    removed,
    view: {
      temporaryAccessPass: tap.temporaryAccessPass,
      lifetimeInMinutes: tap.lifetimeInMinutes,
      startDateTime,
      expireA: tapExpireA(startDateTime, tap.lifetimeInMinutes),
      isUsableOnce: tap.isUsableOnce,
      utilisableDansMinutes: config.tapStartDelayMinutes,
      fuseau: config.timeZone,
    },
  };
}

/**
 * Validé, jour J atteint : compte activé, ajouté au groupe des arrivants, date d'activation écrite, TAP multi-usage
 * (utilisable dans TAP_START_DELAY_MINUTES), puis statut Actif.
 * Pas de nouveau TAP si un TAP valide existe (409) : Entra le remplacerait en silence et le code déjà remis serait perdu.
 * RH remplace un TAP valide par une régénération explicite (regenererTap). Reprise : un compte Validé déjà activé
 * dont le TAP a échoué est accepté ; si le TAP existe mais que le statut n'a pas été posé, passer par regenererTap.
 */
export async function activerDemande(deps: ActivationDeps, actor: string, id: string, now: Date): Promise<Activation> {
  const { config, directory, audit } = deps;
  const { groupId, activationExt } = activationConfig(deps);
  const user = await loadUser(deps, actor, id);
  const refuse = (raison: string, extra?: Record<string, unknown>) => conflict(deps, actor, user, id, raison, extra);

  if (user.statut === 'Terminé') refuse('onboarding_termine');
  if (user.statut === 'Actif') refuse('deja_actif');
  if (user.statut !== 'Validé') refuse('statut');
  if (user.dateArrivee === null) refuse('date_arrivee_absente');
  if ((user.dateArrivee as string) > todayIn(config.timeZone, now)) refuse('date_arrivee_future');

  const fail = { statut: user.statut as string };
  const existants = await step(deps, actor, 'tap_lecture', id, fail, () => directory.listTaps(id));
  const valide = existants.find(tapValide);
  if (valide) refuse('tap_valide', { expireA: tapExpireA(valide.startDateTime, valide.lifetimeInMinutes), fuseau: config.timeZone });

  if (!user.accountEnabled) {
    await step(deps, actor, 'activation_compte', id, fail, () => directory.setAccountEnabled(id, true));
    audit.track({ action: 'demande.compte_active', actor, outcome: 'ok', cible: id });
  }
  // Le groupe porte la politique TAP : posé dès la validation, rejoué ici (sans effet si déjà membre) pour les comptes
  // validés avant ce changement ou si l'ajout de la validation a été annulé à la main.
  await step(deps, actor, 'groupe_arrivants', id, fail, () => directory.addGroupMember(groupId, id));
  audit.track({ action: 'demande.arrivants_ajout', actor, outcome: 'ok', cible: id, groupe: groupId });
  await step(deps, actor, 'activation_date', id, fail, () => directory.setExtension(id, activationExt, now.toISOString()));

  const { view } = await issueTap(deps, actor, id, now, fail);
  // Échec ici : 502 sans TAP dans la réponse ; le TAP existe mais son code n'a jamais été montré : RH régénère.
  await step(deps, actor, 'statut', id, fail, () => directory.setExtension(id, config.statusExtension, 'Actif'));
  audit.track({ action: 'demande.activee', actor, outcome: 'ok', cible: id });
  return { id, statut: 'Actif', regeneration: false, ...view };
}

/**
 * Régénération explicite par RH, avec un motif (code fixe) tracé : remplace le TAP existant, valide ou non.
 * Comptes Actif, ou Validé déjà activé (activation interrompue après la création du TAP : l'activation est alors menée à terme).
 * Interdite une fois l'onboarding Terminé.
 */
export async function regenererTap(deps: ActivationDeps, actor: string, id: string, motif: MotifRegeneration, now: Date): Promise<Activation> {
  const { config, directory, audit } = deps;
  const { groupId, activationExt } = activationConfig(deps);
  const user = await loadUser(deps, actor, id);
  const refuse = (raison: string) => conflict(deps, actor, user, id, raison);

  if (user.statut === 'Terminé') refuse('onboarding_termine');
  const interrompue = user.statut === 'Validé' && user.accountEnabled;
  if (user.statut !== 'Actif' && !interrompue) refuse('statut');
  if (!user.accountEnabled) refuse('compte_desactive');

  const fail = { statut: user.statut as string };
  await step(deps, actor, 'groupe_arrivants', id, fail, () => directory.addGroupMember(groupId, id));
  const { view } = await issueTap(deps, actor, id, now, fail);
  audit.track({ action: 'demande.tap_regenere', actor, outcome: 'ok', cible: id, motif });

  if (interrompue) {
    await step(deps, actor, 'activation_date', id, fail, () => directory.setExtension(id, activationExt, now.toISOString()));
    await step(deps, actor, 'statut', id, fail, () => directory.setExtension(id, config.statusExtension, 'Actif'));
    audit.track({ action: 'demande.activee', actor, outcome: 'ok', cible: id });
  }
  return { id, statut: 'Actif', regeneration: true, ...view };
}

export interface Termine {
  id: string;
  statut: 'Terminé';
  /** true : le compte était déjà Terminé (appel répété). */
  deja: boolean;
}

/**
 * Actif et onboarding complet (revérifié ici, jamais cru sur parole) : TAP supprimé, retrait du groupe des arrivants,
 * puis statut Terminé en dernier. Rejouable : un échec en cours de route laisse le compte Actif, et la reprise
 * refait les étapes (suppression sans effet s'il n'y a plus de TAP, retrait seulement si le compte est encore membre).
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
  const removed = await step(deps, actor, 'tap_suppression', id, fail, async () => {
    const taps = await directory.listTaps(id);
    for (const t of taps) await directory.deleteTap(id, t.id);
    return taps.length;
  });
  if (removed > 0) audit.track({ action: 'demande.tap_supprime', actor, outcome: 'ok', cible: id, nombre: removed });

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
