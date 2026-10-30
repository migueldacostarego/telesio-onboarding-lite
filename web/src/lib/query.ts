import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { isSessionExpiredError, sessionStore } from '@/lib/session';

// Nouvel essai pour les lectures seulement, et seulement si l'échec peut être passager
// (réseau, Graph en échec, 503) : jamais sur un 4xx, qui reviendrait identique.
const RETRYABLE = new Set(['reseau', 'amont', 'indisponible']);
const MAX_RETRIES = 2;

export const shouldRetry = (failureCount: number, error: Error): boolean =>
  failureCount < MAX_RETRIES && error instanceof ApiError && RETRYABLE.has(error.kind);

export function createQueryClient(onSessionExpired: () => void = () => sessionStore.set(true)): QueryClient {
  // Session expirée sur n'importe quel appel (lecture ou écriture) : l'interface bascule sur l'écran de reconnexion.
  const onError = (error: unknown) => {
    if (isSessionExpiredError(error)) onSessionExpired();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { retry: shouldRetry },
      // Jamais de nouvel essai automatique d'une écriture (une remise de mot de passe se rejouerait).
      // gcTime 0 : le résultat d'une mutation (mot de passe temporaire) ne reste pas en cache après usage.
      mutations: { retry: false, gcTime: 0 },
    },
  });
}
