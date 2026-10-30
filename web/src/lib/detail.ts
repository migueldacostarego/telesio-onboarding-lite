import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { EtatOnboarding, Statut } from '@/lib/suivi';
import { shouldRetry } from '@/lib/query';
import type { TypeContrat } from '@/lib/typeContrat';

/** Auteur d'une étape : `nom` null si le compte n'existe plus ; `systeme` : la tâche du serveur. */
export interface Acteur {
  nom: string | null;
  systeme?: true;
}
export interface EtapeFaite {
  /** Date ISO UTC, affichée en heure de Paris. */
  le: string;
  par: Acteur;
}
export interface Historique {
  /** Faux : les extensions d'historique ne sont pas configurées, seule la création est connue. */
  enregistre: boolean;
  creation: { le: string | null; par: Acteur | null };
  validation: EtapeFaite | null;
  activation: EtapeFaite | null;
  regeneration: (EtapeFaite & { nombre: number }) | null;
  /** `le` null : inscrit, mais Entra ne fournit pas la date. */
  authenticator: { le: string | null } | null;
  motDePasse: { le: string } | null;
  termine: EtapeFaite | null;
}

/** GET /api/demandes/:id. */
export interface DemandeDetail {
  id: string;
  nom: string;
  upn: string | null;
  poste: string | null;
  service: string | null;
  /** Type de contrat (employeeType) ; null : compte antérieur au formulaire par type. */
  typeContrat?: TypeContrat | null;
  manager: { nom: string } | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
  statut: Statut;
  etape: 1 | 2 | 3 | 4;
  licence: { libelle: string | null; etat: 'choisie' | 'attribuee' | 'en_cours' | 'erreur' | 'inconnu' } | null;
  groupeArrivants: { membre: boolean } | null;
  dossier: { etat: 'present'; url: string | null } | { etat: 'absent' } | null;
  onboarding?: EtatOnboarding;
  actions: string[];
  historique: Historique;
}

export const DETAIL_KEY = ['demande'] as const;
/** Relecture de la page ouverte : toutes les 30 s (5 s tant que la liste attend la réplication d'Entra). */
export const DETAIL_ACTUALISATION_MS = 30_000;
export const DETAIL_SYNCHRO_MS = 5_000;
/** Essais après un 404 quand la liste montre la demande (compte pas encore répliqué par Entra). */
const ESSAIS_COMPTE_REPLIQUE = 5;

/**
 * Détail d'une demande. L'id est la seule chose qui voyage dans l'adresse. Si la liste montre déjà la demande (`attendue`), un 404
 * est un compte pas encore répliqué : quelques nouveaux essais bornés ; sinon (lien ancien, demande refusée) il est définitif.
 */
export function useDemande(id: string, { attendue, synchro }: { attendue: boolean; synchro: boolean }) {
  return useQuery({
    queryKey: [...DETAIL_KEY, id],
    queryFn: async (): Promise<DemandeDetail> => {
      const res = await api.get<DemandeDetail>(`/api/demandes/${encodeURIComponent(id)}`);
      if (res.kind !== 'ok' || typeof res.data?.id !== 'string' || typeof res.data?.historique !== 'object') {
        throw new ApiError({ status: res.status, kind: 'serveur', message: 'Réponse inattendue du serveur.' });
      }
      return res.data;
    },
    retry: (essais, error) => (attendue && error instanceof ApiError && error.status === 404 ? essais < ESSAIS_COMPTE_REPLIQUE : shouldRetry(essais, error)),
    refetchInterval: synchro ? DETAIL_SYNCHRO_MS : DETAIL_ACTUALISATION_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}
