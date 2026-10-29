import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Session Easy Auth expirée : 401 de l'API, ou réponse qui n'est pas du JSON (redirection vers la connexion).
 * Un 403 n'en fait pas partie (rôle manquant : la session est valable).
 */
export const isSessionExpiredError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 401 || error.kind === 'session');

// Petit store hors React : le QueryClient (créé avant l'arbre) y signale l'expiration.
let expired = false;
const listeners = new Set<() => void>();

export const sessionStore = {
  get: () => expired,
  set(value: boolean) {
    if (expired === value) return;
    expired = value;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useSessionExpired = (): boolean => useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
