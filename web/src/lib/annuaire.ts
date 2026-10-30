import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';

export interface Personne {
  id: string;
  displayName: string;
  mail: string | null;
}

export const TERME_MIN = 2;
export const TERME_MAX = 64;
export const ATTENTE_RECHERCHE_MS = 300;

/** Comme le serveur : espaces réduits, puis 2 à 64 caractères. */
export const normaliserTerme = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Recherche du responsable (GET /api/annuaire?q=). Le terme est un nom : il ne va ni dans l'adresse de la page, ni dans le
 * stockage du navigateur, et la requête ne reste pas en cache (`gcTime: 0`). Il voyage dans la requête de l'API, comme pour
 * les pages actuelles (`q` : l'API n'a pas d'autre forme ; le serveur ne le trace pas, seulement sa longueur).
 */
export function useAnnuaire(terme: string) {
  const t = normaliserTerme(terme);
  return useQuery({
    queryKey: ['annuaire', t],
    enabled: t.length >= TERME_MIN && t.length <= TERME_MAX,
    gcTime: 0,
    staleTime: 0,
    queryFn: async (): Promise<Personne[]> => {
      const res = await api.get<Personne[]>(`/api/annuaire?q=${encodeURIComponent(t)}`);
      if (res.kind !== 'ok' || !Array.isArray(res.data)) throw new ApiError({ status: res.status, kind: 'serveur', message: 'Réponse inattendue du serveur.' });
      return res.data.filter((p) => typeof p.id === 'string' && typeof p.displayName === 'string').map((p) => ({ id: p.id, displayName: p.displayName, mail: typeof p.mail === 'string' ? p.mail : null }));
    },
  });
}
