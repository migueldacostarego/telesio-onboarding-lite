import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';

/** Statuts renvoyés par GET /api/suivi, dans l'ordre du parcours (étape 1 à 4). */
export const STATUTS = ['EnAttente', 'Validé', 'Actif', 'Terminé'] as const;
export type Statut = (typeof STATUTS)[number];

/** Libellés affichés (féminin : une demande). */
export const LIBELLES: Record<Statut, string> = {
  EnAttente: 'En attente',
  Validé: 'Validée',
  Actif: 'Activée',
  Terminé: 'Terminée',
};

export const NB_ETAPES = STATUTS.length;

/** État d'onboarding d'un compte Actif (GET /api/suivi) : { verification: 'echec' } si la lecture Graph de ce compte a échoué. */
export interface Onboarding {
  motDePasse: boolean;
  authenticator: boolean;
  termine: boolean;
}
export type EtatOnboarding = Onboarding | { verification: 'echec' };

/** Vrai si l'API dit que le mot de passe a changé et qu'Authenticator est inscrit (la finalisation passe par POST /terminer). */
export const onboardingComplet = (o: EtatOnboarding | undefined): boolean => o !== undefined && 'termine' in o && o.termine === true;

/** Une demande de GET /api/suivi (les champs que l'écran lit). */
export interface Demande {
  id: string;
  nom: string;
  poste: string | null;
  service: string | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
  statut: Statut;
  /** 1 EnAttente, 2 Validé, 3 Actif, 4 Terminé. */
  etape: number;
  /** Ce que la personne connectée peut faire : `approuver`, `refuser`, `activer`, `regenerer`. L'interface n'en propose pas d'autre. */
  actions: string[];
  /** Comptes Actif seulement. */
  onboarding?: EtatOnboarding;
}

export interface Suivi {
  demandes: Demande[];
  /** La liste est incomplète (au plus 100 demandes par statut). */
  tronque: boolean;
}

export const SUIVI_KEY = ['suivi'] as const;
/** Actualisation automatique : toutes les 30 s, et au retour sur l'onglet. */
export const ACTUALISATION_MS = 30_000;

export function useSuivi() {
  return useQuery({
    queryKey: SUIVI_KEY,
    queryFn: async (): Promise<Suivi> => {
      const res = await api.get<Suivi>('/api/suivi');
      if (res.kind !== 'ok' || !Array.isArray(res.data?.demandes)) {
        throw new ApiError({ status: res.status, kind: 'serveur', message: 'Réponse inattendue du serveur.' });
      }
      return { demandes: res.data.demandes, tronque: res.data.tronque === true };
    },
    // Les données restent affichées pendant l'actualisation (pas de squelette, pas de clignotement).
    refetchInterval: ACTUALISATION_MS,
    // Seulement onglet visible : au retour, refetchOnWindowFocus relit si les données ont plus de staleTime.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

// ---- Affichage

const DATE_FR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** « 3 nov. 2026 » à partir de AAAA-MM-JJ (lue en UTC : le fuseau du navigateur ne décale jamais le jour). */
export function formatArrivee(iso: string | null): string {
  if (!iso) return 'Non renseignée';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? 'Non renseignée' : DATE_FR.format(d);
}

const RELATIF = new Intl.RelativeTimeFormat('fr', { numeric: 'always', style: 'short' });

/** « à l'instant », « il y a 20 s », « il y a 3 min », « il y a 2 h » (par pas de 5 s sous la minute). */
export function ilYA(depuis: number, maintenant: number): string {
  const s = Math.max(0, Math.floor((maintenant - depuis) / 1000));
  if (s < 5) return 'à l’instant';
  if (s < 60) return RELATIF.format(-Math.floor(s / 5) * 5, 'second');
  if (s < 3600) return RELATIF.format(-Math.floor(s / 60), 'minute');
  return RELATIF.format(-Math.floor(s / 3600), 'hour');
}

// ---- Recherche, filtre, tri (côté client : le terme ne va jamais dans l'URL ni le stockage)

/**
 * avenir (défaut) : les arrivées d'aujourd'hui et à venir, de la plus proche à la plus lointaine, puis les passées, de la
 * plus récente à la plus ancienne ; recentes / anciennes : ordre chronologique inverse / direct. Sans date : toujours en dernier.
 */
export type Tri = 'avenir' | 'recentes' | 'anciennes';
export type FiltreStatut = Statut | 'tous';

/** Minuscules sans accents : « Éloïse » se trouve avec « eloise ». */
export const normaliser = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** AAAA-MM-JJ du jour dans le fuseau du navigateur (le jour que voit la personne qui lit l'écran). */
export function aujourdhui(maintenant: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${p(maintenant.getMonth() + 1)}-${p(maintenant.getDate())}`;
}

export function filtrerDemandes(
  demandes: readonly Demande[],
  o: { terme: string; statut: FiltreStatut; tri: Tri; aujourdhui: string },
): Demande[] {
  const mots = normaliser(o.terme).split(/\s+/).filter(Boolean);
  const retenues = demandes.filter((d) => {
    if (o.statut !== 'tous' && d.statut !== o.statut) return false;
    const nom = normaliser(d.nom);
    return mots.every((m) => nom.includes(m));
  });
  // Rang : 0 = à venir (ou aujourd'hui), 1 = passée, 2 = sans date. Les modes chronologiques n'en tiennent compte que pour « sans date ».
  const rang = (d: Demande) => (d.dateArrivee === null ? 2 : d.dateArrivee >= o.aujourdhui ? 0 : 1);
  return retenues.sort((a, b) => {
    const ra = o.tri === 'avenir' ? rang(a) : rang(a) === 2 ? 2 : 0;
    const rb = o.tri === 'avenir' ? rang(b) : rang(b) === 2 ? 2 : 0;
    if (ra !== rb) return ra - rb;
    if (a.dateArrivee !== b.dateArrivee && a.dateArrivee !== null && b.dateArrivee !== null) {
      // À venir : la plus proche d'abord (croissant). Passées : la plus récente d'abord (décroissant).
      const croissant = o.tri === 'anciennes' || (o.tri === 'avenir' && ra === 0);
      return a.dateArrivee < b.dateArrivee === croissant ? -1 : 1;
    }
    return a.nom.localeCompare(b.nom, 'fr');
  });
}
