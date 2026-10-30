import { describe, expect, it } from 'vitest';
import { ApiError, type ApiErrorKind } from '@/lib/api';
import { createQueryClient, shouldRetry } from '@/lib/query';

const err = (kind: ApiErrorKind) => new ApiError({ status: 0, kind, message: 'x' });

describe('politique de nouvel essai', () => {
  it.each<ApiErrorKind>(['reseau', 'amont', 'indisponible'])('réessaie une lecture en échec passager (%s), deux fois au plus', (kind) => {
    expect(shouldRetry(0, err(kind))).toBe(true);
    expect(shouldRetry(1, err(kind))).toBe(true);
    expect(shouldRetry(2, err(kind))).toBe(false);
  });

  it.each<ApiErrorKind>(['invalide', 'non_autorise', 'introuvable', 'conflit', 'session', 'serveur'])('ne réessaie pas un échec %s', (kind) => {
    expect(shouldRetry(0, err(kind))).toBe(false);
  });

  it('ne réessaie pas une erreur inconnue', () => {
    expect(shouldRetry(0, new Error('boom'))).toBe(false);
  });

  it('ne réessaie jamais une écriture et ne garde pas son résultat en cache', () => {
    const { mutations } = createQueryClient().getDefaultOptions();
    expect(mutations).toMatchObject({ retry: false, gcTime: 0 });
  });
});
