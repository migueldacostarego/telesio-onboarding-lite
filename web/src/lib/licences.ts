import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';

export interface Licence {
  skuId: string;
  libelle: string;
  /** Unités libres : 0 = non choisissable. */
  disponibles: number;
}

/** GET /api/licences : lu à chaque ouverture du formulaire (le serveur le met en cache 60 s). */
export function useLicences(actif: boolean) {
  return useQuery({
    queryKey: ['licences'],
    enabled: actif,
    staleTime: 0,
    queryFn: async (): Promise<Licence[]> => {
      const res = await api.get<{ licences: Licence[] }>('/api/licences');
      if (res.kind !== 'ok' || !Array.isArray(res.data?.licences)) throw new ApiError({ status: res.status, kind: 'serveur', message: 'Réponse inattendue du serveur.' });
      return res.data.licences;
    },
  });
}
