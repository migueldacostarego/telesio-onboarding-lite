import { addDays, todayIn } from './dates';
import { step } from './direction';
import type { PendingDemande } from './directory';
import { activationConfig, inspectActifs, type ActivationDeps, type OnboardingState } from './activation';

/** Comptes renvoyés par statut au plus (`tronque` l'indique au-delà). */
export const MAX_PAR_STATUT = 100;
/** Un compte Terminé reste visible 30 jours après son activation. */
export const FENETRE_TERMINE_JOURS = 30;
/**
 * La date d'activation n'est pas filtrable côté Graph (statut + date + $expand est refusé). On ne lit donc l'activation
 * que des comptes Terminé dont la date d'arrivée est dans la fenêtre augmentée de ce délai : un compte activé plus de
 * 60 jours après sa date d'arrivée n'apparaît pas. Cela borne les lectures Graph.
 */
export const DELAI_ACTIVATION_MAX_JOURS = 60;

const STATUTS = ['EnAttente', 'Validé', 'Actif', 'Terminé'] as const;
type Statut = (typeof STATUTS)[number];

export interface SuiviItem {
  id: string;
  nom: string;
  poste: string | null;
  service: string | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
  statut: Statut;
  /** 1 EnAttente, 2 Validé, 3 Actif, 4 Terminé. */
  etape: 1 | 2 | 3 | 4;
  /** Comptes Actif seulement ; { verification: 'echec' } si la lecture Graph a échoué pour ce compte. */
  onboarding?: OnboardingState | { verification: 'echec' };
}

const item = (d: PendingDemande, statut: Statut, onboarding?: SuiviItem['onboarding']): SuiviItem => ({
  id: d.id,
  nom: d.nom,
  poste: d.poste,
  service: d.service,
  dateArrivee: d.dateArrivee,
  statut,
  etape: (STATUTS.indexOf(statut) + 1) as SuiviItem['etape'],
  ...(onboarding ? { onboarding } : {}),
});

/**
 * Suivi RH : demandes EnAttente, Validé, Actif (avec l'état d'onboarding, comme /activations) et Terminé activées
 * depuis moins de 30 jours. Lecture seule, aucune permission Graph de plus (listByStatut, getOnboardingProgress,
 * inspectOnboarding). Les Terminé sont triés de l'activation la plus récente à la plus ancienne.
 */
export async function listSuivi(deps: ActivationDeps, actor: string, now: Date): Promise<{ demandes: SuiviItem[]; tronque: boolean }> {
  const { config, directory, audit } = deps;
  const { activationExt } = activationConfig(deps);
  const ext = config.statusExtension;
  const aujourdhui = todayIn(config.timeZone, now);
  const arriveeMin = addDays(aujourdhui, -(FENETRE_TERMINE_JOURS + DELAI_ACTIVATION_MAX_JOURS));
  const seuil = now.getTime() - FENETRE_TERMINE_JOURS * 86_400_000;

  const [attente, valides, actifs, termines] = await step(deps, actor, 'liste', undefined, {}, () =>
    Promise.all([
      directory.listByStatut(ext, 'EnAttente'),
      directory.listByStatut(ext, 'Validé'),
      directory.listByStatut(ext, 'Actif'),
      directory.listByStatut(ext, 'Terminé', arriveeMin),
    ]),
  );

  // Activation des Terminé candidats : date d'activation, à défaut création du compte (activé avant l'extension),
  // comme inspectOnboarding. Une lecture en échec (tracée par step) ne masque pas le compte : date inconnue, gardé.
  const dates = await Promise.all(
    termines.demandes.map(async (d) => {
      const progress = await step(deps, actor, 'suivi_activation', d.id, {}, () => directory.getOnboardingProgress(d.id, activationExt)).catch(() => null);
      const at = progress ? Date.parse(progress.activation ?? progress.createdDateTime ?? '') : NaN;
      return { d, at };
    }),
  );
  const recents = dates
    .filter(({ at }) => !Number.isFinite(at) || at >= seuil)
    .sort((a, b) => (Number.isFinite(b.at) ? b.at : -Infinity) - (Number.isFinite(a.at) ? a.at : -Infinity))
    .map(({ d }) => d);

  const gardes = {
    attente: attente.demandes.slice(0, MAX_PAR_STATUT),
    valides: valides.demandes.slice(0, MAX_PAR_STATUT),
    actifs: actifs.demandes.slice(0, MAX_PAR_STATUT),
    termines: recents.slice(0, MAX_PAR_STATUT),
  };
  const tronque =
    attente.tronque || valides.tronque || actifs.tronque || termines.tronque ||
    attente.demandes.length > MAX_PAR_STATUT || valides.demandes.length > MAX_PAR_STATUT ||
    actifs.demandes.length > MAX_PAR_STATUT || recents.length > MAX_PAR_STATUT;

  const demandes: SuiviItem[] = [
    ...gardes.attente.map((d) => item(d, 'EnAttente')),
    ...gardes.valides.map((d) => item(d, 'Validé')),
    ...(await inspectActifs(deps, actor, gardes.actifs)).map((d) => item(d, 'Actif', d.onboarding)),
    ...gardes.termines.map((d) => item(d, 'Terminé')),
  ];
  audit.track({ action: 'suivi.liste', actor, outcome: 'ok', resultats: demandes.length, tronque });
  return { demandes, tronque };
}
