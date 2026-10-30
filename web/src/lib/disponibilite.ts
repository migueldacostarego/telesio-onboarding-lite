import { useQuery } from '@tanstack/react-query';
import { useDebounced } from '@/hooks/useDebounced';
import { ApiError, api } from '@/lib/api';

export const ATTENTE_DISPONIBILITE_MS = 400;

/** inconnue : rien à vérifier (adresse vide ou mal formée) ; erreur : la vérification a échoué (le serveur revérifie à l'envoi). */
export type Disponibilite = 'inconnue' | 'verification' | 'disponible' | 'pris' | 'erreur';

/**
 * L'adresse est-elle libre dans Entra ? POST /api/annuaire/disponibilite, 400 ms après la dernière frappe. L'adresse est une donnée
 * personnelle : elle voyage dans le corps de la requête (jamais dans l'adresse de la page ni dans le stockage du navigateur) et la
 * requête ne reste pas en cache (`gcTime: 0`). `adresse` : null tant qu'elle n'est pas bien formée (aucun appel).
 */
export function useDisponibilite(adresse: string | null): Disponibilite {
  const attendue = useDebounced(adresse, ATTENTE_DISPONIBILITE_MS);
  const requete = useQuery({
    queryKey: ['email-disponible', attendue],
    enabled: attendue !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const res = await api.post<{ disponible: boolean }>('/api/annuaire/disponibilite', { email: attendue });
      if (res.kind !== 'ok' || typeof res.data?.disponible !== 'boolean') throw new ApiError({ status: res.status, kind: 'serveur', message: 'Réponse inattendue du serveur.' });
      return res.data.disponible;
    },
  });
  if (adresse === null) return 'inconnue';
  if (attendue !== adresse || requete.isFetching) return 'verification';
  if (requete.isError) return 'erreur';
  if (requete.isSuccess) return requete.data ? 'disponible' : 'pris';
  return 'verification';
}
