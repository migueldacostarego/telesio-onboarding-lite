import { MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiErrorKind } from '@/lib/api';
import { createQueryClient } from '@/lib/query';
import { isSessionExpiredError, sessionStore } from '@/lib/session';

const err = (status: number, kind: ApiErrorKind) => new ApiError({ status, kind, message: 'x' });

describe('session expirée', () => {
  it('401 et réponse hors JSON (redirection de connexion) expirent la session ; 403, 409, 502 et réseau non', () => {
    expect(isSessionExpiredError(err(401, 'non_autorise'))).toBe(true);
    expect(isSessionExpiredError(err(0, 'session'))).toBe(true);
    expect(isSessionExpiredError(err(403, 'non_autorise'))).toBe(false);
    expect(isSessionExpiredError(err(409, 'conflit'))).toBe(false);
    expect(isSessionExpiredError(err(502, 'amont'))).toBe(false);
    expect(isSessionExpiredError(err(0, 'reseau'))).toBe(false);
    expect(isSessionExpiredError(new Error('401'))).toBe(false);
  });

  it('une lecture en 401 déclenche le rappel, sans nouvel essai', async () => {
    const onExpired = vi.fn();
    const queryFn = vi.fn(() => Promise.reject(err(401, 'non_autorise')));
    await createQueryClient(onExpired).fetchQuery({ queryKey: ['x'], queryFn }).catch(() => undefined);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('une écriture en 401 le déclenche aussi', async () => {
    const onExpired = vi.fn();
    const client = createQueryClient(onExpired);
    await new MutationObserver(client, { mutationFn: () => Promise.reject(err(401, 'non_autorise')) }).mutate().catch(() => undefined);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it.each([err(403, 'non_autorise'), err(409, 'conflit'), err(400, 'invalide')])('une erreur %s ne le déclenche pas', async (e) => {
    const onExpired = vi.fn();
    await createQueryClient(onExpired).fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(e) }).catch(() => undefined);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('par défaut, le rappel bascule le store de session', async () => {
    expect(sessionStore.get()).toBe(false);
    await createQueryClient().fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(err(401, 'non_autorise')) }).catch(() => undefined);
    expect(sessionStore.get()).toBe(true);
  });
});
