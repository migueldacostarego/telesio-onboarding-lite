import { addDays, todayIn } from './dates';
import { ServiceError } from './demandes';
import { step, type DirectionDeps } from './direction';
import type { PendingDemande } from './directory';

export type ActivationDeps = Pick<DirectionDeps, 'config' | 'directory' | 'audit'>;

export interface ActivationItem extends PendingDemande {
  statut: 'Validé' | 'Actif';
  /** activer : jour J atteint ; attendre : arrivée dans le futur ; regenerer : compte déjà Actif, TAP à refaire. */
  action: 'activer' | 'attendre' | 'regenerer';
}

/** Comptes Validé, plus les Actif arrivés depuis moins de TAP_REGEN_WINDOW_DAYS (pour « Régénérer »). */
export async function listActivations(
  deps: ActivationDeps,
  actor: string,
  now: Date,
): Promise<{ demandes: ActivationItem[]; tronque: boolean }> {
  const { config, directory, audit } = deps;
  const today = todayIn(config.timeZone, now);
  const since = addDays(today, -config.tapRegenWindowDays);
  const [valides, actifs] = await step(deps, actor, 'liste', undefined, {}, () =>
    Promise.all([
      directory.listByStatut(config.statusExtension, 'Validé'),
      directory.listByStatut(config.statusExtension, 'Actif', since),
    ]),
  );
  const demandes: ActivationItem[] = [
    ...valides.demandes.map((d) => ({
      ...d,
      statut: 'Validé' as const,
      action: d.dateArrivee !== null && d.dateArrivee <= today ? ('activer' as const) : ('attendre' as const),
    })),
    ...actifs.demandes.map((d) => ({ ...d, statut: 'Actif' as const, action: 'regenerer' as const })),
  ];
  audit.track({ action: 'activation.liste', actor, outcome: 'ok', resultats: demandes.length });
  return { demandes, tronque: valides.tronque || actifs.tronque };
}

export interface Activation {
  id: string;
  statut: 'Actif';
  /** true : TAP recréé sur un compte déjà activé (reprise après échec, ou « Régénérer »). */
  regeneration: boolean;
  /** Visible une seule fois : à remettre en main propre, jamais tracé ni mis en cache. */
  temporaryAccessPass: string;
  lifetimeInMinutes: number;
  startDateTime: string | null;
  isUsableOnce: boolean;
}

/**
 * Validé → compte activé → TAP (l'éventuel TAP existant est supprimé) → statut Actif.
 * Reprises acceptées : Validé avec compte déjà activé (le TAP avait échoué), et Actif récent
 * (« Régénérer », dans la fenêtre TAP_REGEN_WINDOW_DAYS). Tout le reste : 409.
 */
export async function activerDemande(
  deps: ActivationDeps,
  actor: string,
  id: string,
  now: Date,
): Promise<Activation> {
  const { config, directory, audit } = deps;
  const today = todayIn(config.timeZone, now);
  const user = await step(deps, actor, 'lecture', id, {}, () =>
    directory.getOnboardingUser(id, config.statusExtension),
  );
  if (!user) {
    audit.track({ action: 'demande.introuvable', actor, outcome: 'refuse', cible: id });
    throw new ServiceError(404, { error: 'Demande introuvable' });
  }

  const conflict = (raison: string): never => {
    audit.track({ action: 'activation.conflit', actor, outcome: 'refuse', cible: id, statut: user.statut ?? 'inconnu', raison });
    throw new ServiceError(409, { error: 'Activation impossible', raison });
  };
  const regeneration = user.statut === 'Actif';
  if (user.statut !== 'Validé' && !(regeneration && user.accountEnabled)) conflict('statut');
  if (user.dateArrivee === null) conflict('date_arrivee_absente');
  if (!regeneration && (user.dateArrivee as string) > today) conflict('date_arrivee_future');
  if (regeneration && (user.dateArrivee as string) < addDays(today, -config.tapRegenWindowDays)) {
    conflict('fenetre_regeneration_depassee');
  }

  const fail = { statut: user.statut as string };
  if (!user.accountEnabled) {
    await step(deps, actor, 'activation_compte', id, fail, () => directory.setAccountEnabled(id, true));
    audit.track({ action: 'demande.compte_active', actor, outcome: 'ok', cible: id });
  }

  // Un seul TAP par compte : on supprime l'existant avant d'en créer un nouveau.
  const removed = await step(deps, actor, 'tap_nettoyage', id, fail, async () => {
    const ids = await directory.listTapIds(id);
    for (const tapId of ids) await directory.deleteTap(id, tapId);
    return ids.length;
  });
  if (removed > 0) audit.track({ action: 'demande.tap_supprime', actor, outcome: 'ok', cible: id, nombre: removed });

  const tap = await step(deps, actor, 'tap_creation', id, fail, () =>
    directory.createTap(id, config.tapLifetimeMinutes),
  );
  // Jamais la valeur du TAP : seulement qu'il a été créé, et pour quelle durée.
  audit.track({
    action: 'demande.tap_cree',
    actor,
    outcome: 'ok',
    cible: id,
    dureeMinutes: tap.lifetimeInMinutes,
    regeneration: removed > 0 || regeneration,
  });

  if (!regeneration) {
    // Échec ici : 502 sans TAP dans la réponse ; la reprise (Validé + compte activé) recrée un TAP.
    await step(deps, actor, 'statut', id, fail, () =>
      directory.setExtension(id, config.statusExtension, 'Actif'),
    );
    audit.track({ action: 'demande.activee', actor, outcome: 'ok', cible: id });
  }

  return {
    id,
    statut: 'Actif',
    regeneration: removed > 0 || regeneration,
    temporaryAccessPass: tap.temporaryAccessPass,
    lifetimeInMinutes: tap.lifetimeInMinutes,
    startDateTime: tap.startDateTime,
    isUsableOnce: tap.isUsableOnce,
  };
}
