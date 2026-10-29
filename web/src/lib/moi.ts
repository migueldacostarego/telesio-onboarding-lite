import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';

/**
 * Ce que la personne peut faire, calculé par le serveur d'après rh_role et direction_role : l'interface n'a aucun
 * nom de rôle en dur et ne décide jamais d'un droit à partir de `roles`.
 */
export interface Droits {
  /** Au moins un des trois droits suivants. */
  acces: boolean;
  creer: boolean;
  approuver: boolean;
  activer: boolean;
}

/** GET /api/moi : l'identité Easy Auth de la personne connectée. */
export interface Moi {
  nom: string;
  email: string | null;
  /** Rôles d'application du jeton, tels quels : affichés dans le badge, jamais testés. */
  roles: string[];
  droits: Droits;
}

export const MOI_KEY = ['moi'] as const;

export function useMoi(enabled = true) {
  return useQuery({
    queryKey: MOI_KEY,
    queryFn: async () => {
      const res = await api.get<Moi>('/api/moi');
      if (res.kind !== 'ok') throw new ApiError({ status: res.status, kind: 'serveur', message: 'Réponse inattendue du serveur.' });
      return res.data;
    },
    // Revérifié au retour sur l'onglet après une minute : une session expirée est détectée sans attendre une action.
    staleTime: 60_000,
    enabled,
  });
}
