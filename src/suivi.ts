import type { Droits } from './auth';
import { addDays, todayIn } from './dates';
import { step, type DirectionDeps } from './direction';
import { buildFolderName } from './folder';
import { graphFailureProps, type PendingDemande } from './directory';
import { decoderEvenement } from './history';
import type { TypeContrat } from './typeContrat';
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

export const STATUTS = ['EnAttente', 'Validé', 'Actif', 'Terminé'] as const;
export type Statut = (typeof STATUTS)[number];

/** Actions proposées à la personne connectée pour une demande (calculées côté serveur, jamais déduites par l'interface). */
export type SuiviAction = 'approuver' | 'refuser' | 'activer' | 'regenerer' | 'reprendre';

export interface SuiviItem {
  id: string;
  nom: string;
  /** Adresse professionnelle du compte (userPrincipalName), null si Graph ne l'a pas renvoyée. */
  upn: string | null;
  poste: string | null;
  service: string | null;
  /** Type de contrat (employeeType) ; null : compte antérieur au formulaire par type, ou valeur inconnue. */
  typeContrat: TypeContrat | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
  statut: Statut;
  /** 1 EnAttente, 2 Validé, 3 Actif, 4 Terminé. */
  etape: 1 | 2 | 3 | 4;
  /**
   * Comptes Terminé seulement : le passage à Terminé date du mois en cours (calendrier du fuseau métier, Paris par défaut) ?
   * `null` : inconnu (compte terminé avant l'historique et activé un mois plus tôt : il a pu l'être ce mois-ci).
   */
  termineCeMois?: boolean | null;
  /** Comptes Actif seulement ; { verification: 'echec' } si la lecture Graph a échoué pour ce compte. */
  onboarding?: OnboardingState | { verification: 'echec' };
  /**
   * Actions disponibles pour la personne connectée : approuver et refuser (droit approuver, EnAttente, y compris sa propre
   * demande : l'auto-approbation est autorisée et tracée), activer (droit activer, Validé, date d'arrivée atteinte dans TZ_METIER), regenerer (droit activer, Actif : l'onboarding n'est pas Terminé, sinon le statut
   * serait Terminé), reprendre (droit approuver, Validé dont le dossier SharePoint manque : recrée le dossier seulement). Vide sinon : l'interface ne propose que ce qui figure ici.
   */
  actions: SuiviAction[];
}

/** Le jour J est atteint : comme la route `activer` (jour calculé dans TZ_METIER), une date d'arrivée absente ou à venir n'ouvre pas l'activation. */
const arriveeAtteinte = (d: Pick<PendingDemande, 'dateArrivee'>, aujourdhui: string): boolean => d.dateArrivee !== null && d.dateArrivee <= aujourdhui;

export function actionsFor(d: Pick<PendingDemande, 'dateArrivee'>, statut: Statut, droits: Droits, aujourdhui: string, dossierManquant: boolean): SuiviAction[] {
  if (statut === 'EnAttente') return droits.approuver ? ['approuver', 'refuser'] : [];
  if (statut === 'Validé') {
    const actions: SuiviAction[] = [];
    if (droits.activer && arriveeAtteinte(d, aujourdhui)) actions.push('activer');
    if (droits.approuver && dossierManquant) actions.push('reprendre');
    return actions;
  }
  if (statut === 'Actif') return droits.activer ? ['regenerer'] : [];
  return [];
}

const item = (d: PendingDemande, statut: Statut, droits: Droits, aujourdhui: string, onboarding?: SuiviItem['onboarding'], dossierManquant = false, termineCeMois?: boolean | null): SuiviItem => ({
  id: d.id,
  nom: d.nom,
  upn: d.upn,
  poste: d.poste,
  service: d.service,
  typeContrat: d.typeContrat,
  dateArrivee: d.dateArrivee,
  statut,
  etape: (STATUTS.indexOf(statut) + 1) as SuiviItem['etape'],
  ...(onboarding ? { onboarding } : {}),
  ...(termineCeMois !== undefined ? { termineCeMois } : {}),
  actions: actionsFor(d, statut, droits, aujourdhui, dossierManquant),
});

/**
 * Suivi RH : demandes EnAttente, Validé, Actif (avec l'état d'onboarding, comme /activations) et Terminé activées
 * depuis moins de 30 jours. Lecture seule, aucune permission Graph de plus (listByStatut, getOnboardingProgress,
 * inspectOnboarding). Les Terminé sont triés de l'activation la plus récente à la plus ancienne. `actions` est calculé pour
 * `actor` d'après ses `droits` (le créateur d'une demande n'en est pas exclu).
 */
export async function listSuivi(
  deps: ActivationDeps & Pick<DirectionDeps, 'library'>,
  actor: string,
  now: Date,
  droits: Droits,
): Promise<{ demandes: SuiviItem[]; tronque: boolean }> {
  const { config, directory, audit } = deps;
  const { activationExt } = activationConfig(deps);
  const ext = config.statusExtension;
  const aujourdhui = todayIn(config.timeZone, now);
  const arriveeMin = addDays(aujourdhui, -(FENETRE_TERMINE_JOURS + DELAI_ACTIVATION_MAX_JOURS));
  const seuil = now.getTime() - FENETRE_TERMINE_JOURS * 86_400_000;

  const [attente, valides, actifs, termines] = await step(deps, actor, 'liste', undefined, {}, () =>
    Promise.all([
      directory.listByStatut(ext, 'EnAttente'),
      // Prénom et nom : seulement pour calculer le nom du dossier (jamais renvoyés). Utile à la direction seule.
      directory.listByStatut(ext, 'Validé', undefined, droits.approuver && deps.library !== undefined),
      directory.listByStatut(ext, 'Actif'),
      // La date de fin (extension d'historique) est lue dans la même requête : aucune lecture de plus pour « ce mois-ci ».
      directory.listByStatut(ext, 'Terminé', arriveeMin, false, config.history ? [config.history.termine] : []),
    ]),
  );

  // Activation des Terminé candidats : date d'activation, à défaut création du compte (activé avant l'extension),
  // comme inspectOnboarding. Une lecture en échec (tracée par step) ne masque pas le compte : date inconnue, gardé.
  const moisCourant = aujourdhui.slice(0, 7);
  const moisDe = (ms: number): string => todayIn(config.timeZone, new Date(ms)).slice(0, 7);
  const dates = await Promise.all(
    termines.demandes.map(async (d) => {
      const progress = await step(deps, actor, 'suivi_activation', d.id, {}, () => directory.getOnboardingProgress(d.id, activationExt)).catch(() => null);
      const at = progress ? Date.parse(progress.activation ?? progress.createdDateTime ?? '') : NaN;
      // Terminé ce mois-ci (calendrier du fuseau métier) : la date de fin si elle est enregistrée ; sinon, un compte activé ce mois-ci
      // est forcément terminé ce mois-ci (la fin suit l'activation et ne peut pas être dans le futur) ; sinon on ne sait pas.
      const fin = Date.parse(config.history ? (decoderEvenement(d.extensions?.[config.history.termine])?.le ?? '') : '');
      const ceMois: boolean | null = Number.isFinite(fin) ? moisDe(fin) === moisCourant : Number.isFinite(at) && moisDe(at) === moisCourant ? true : null;
      return { d, at, ceMois };
    }),
  );
  // Fenêtre : activés depuis moins de 30 jours, et aussi tous ceux terminés ce mois-ci (activation plus ancienne, onboarding long).
  const recents = dates
    .filter(({ at, ceMois }) => !Number.isFinite(at) || at >= seuil || ceMois === true)
    .sort((a, b) => (Number.isFinite(b.at) ? b.at : -Infinity) - (Number.isFinite(a.at) ? a.at : -Infinity));

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

  const manquants = await dossiersManquants(deps, actor, gardes.valides, droits);

  const demandes: SuiviItem[] = [
    ...gardes.attente.map((d) => item(d, 'EnAttente', droits, aujourdhui)),
    ...gardes.valides.map((d) => item(d, 'Validé', droits, aujourdhui, undefined, manquants.has(d.id))),
    ...(await inspectActifs(deps, actor, gardes.actifs)).map((d) => item(d, 'Actif', droits, aujourdhui, d.onboarding)),
    ...gardes.termines.map(({ d, ceMois }) => item(d, 'Terminé', droits, aujourdhui, undefined, false, ceMois)),
  ];
  audit.track({ action: 'suivi.liste', actor, outcome: 'ok', resultats: demandes.length, tronque });
  return { demandes, tronque };
}

/**
 * Comptes Validé dont le dossier SharePoint n'existe pas (échec après la validation). Une seule lecture de la racine de la
 * bibliothèque, pas une par compte ; seulement pour la direction et seulement s'il y a des comptes Validé. Aucune réponse
 * sûre (lecture en échec, liste coupée au plafond de pages, nom de dossier impossible à former) : aucune action proposée,
 * jamais de reprise à l'aveugle. La lecture reste couverte par le droit `write` du site (Sites.Selected), aucune permission de plus.
 */
async function dossiersManquants(
  deps: ActivationDeps & Pick<DirectionDeps, 'library'>,
  actor: string,
  valides: readonly PendingDemande[],
  droits: Droits,
): Promise<Set<string>> {
  const manquants = new Set<string>();
  const { library, config, audit } = deps;
  if (!droits.approuver || !library || valides.length === 0) return manquants;
  try {
    const { noms, complet } = await library.listFolderNames();
    if (!complet) return manquants;
    for (const d of valides) {
      let nom: string;
      try {
        nom = buildFolderName(config.sharePoint.folderPattern, { nom: d.famille ?? '', prenom: d.prenom ?? '', id: d.id });
      } catch {
        continue;
      }
      if (!noms.has(nom.toLowerCase())) manquants.add(d.id);
    }
  } catch (err) {
    audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape: 'suivi_dossiers', ...graphFailureProps(err) });
  }
  return manquants;
}
