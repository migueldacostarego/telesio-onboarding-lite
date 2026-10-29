import type { AccessToken, TokenCredential } from '@azure/identity';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/audit';
import { createGraphClient, observeCredential } from '../src/graph';
import { decodeTokenInfo, latestTokenInfo, recordTokenInfo } from '../src/tokenRoles';

const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

const IAT = 1_793_000_000;
const credentialOf = (...tokens: string[]): TokenCredential => {
  let i = 0;
  return { getToken: async (): Promise<AccessToken> => ({ token: tokens[Math.min(i++, tokens.length - 1)] as string, expiresOnTimestamp: 0 }) };
};
const recorder = () => {
  const events: AuditEvent[] = [];
  return { events, audit: { track: (e: AuditEvent) => void events.push(e), flush: async () => {} } };
};

afterEach(() => recordTokenInfo(undefined));

describe('decodeTokenInfo', () => {
  it('lit les noms de rôles (triés), iat et exp ; ignore le reste', () => {
    const info = decodeTokenInfo(jwt({ roles: ['User.Read.All', 'LicenseAssignment.Read.All', 42], iat: IAT, exp: IAT + 3600, oid: 'x', upn: 'a@b.c' }));
    expect(info).toEqual({
      roles: ['LicenseAssignment.Read.All', 'User.Read.All'],
      issuedAt: new Date(IAT * 1000).toISOString(),
      expiresAt: new Date((IAT + 3600) * 1000).toISOString(),
    });
    expect(JSON.stringify(info)).not.toContain('a@b.c');
  });

  it('jeton sans revendication roles : liste vide ; jeton illisible : undefined', () => {
    expect(decodeTokenInfo(jwt({ iat: IAT }))?.roles).toEqual([]);
    expect(decodeTokenInfo('pas-un-jwt')).toBeUndefined();
    expect(decodeTokenInfo('a.%%%.c')).toBeUndefined();
  });
});

describe('observeCredential / warmUp', () => {
  it('trace graph.jeton (rôles, dates) au premier jeton et à chaque nouvel instant d’émission, jamais le jeton', async () => {
    const { events, audit } = recorder();
    const a = jwt({ roles: ['User.Read.All'], iat: IAT, exp: IAT + 3600 });
    const b = jwt({ roles: ['User.Read.All', 'LicenseAssignment.Read.All'], iat: IAT + 60, exp: IAT + 3660 });
    const cred = observeCredential(credentialOf(a, a, b), audit);
    await cred.getToken('s');
    await cred.getToken('s');
    await cred.getToken('s');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ action: 'graph.jeton', outcome: 'ok', jetonRoles: 'User.Read.All', jetonNbRoles: 1 });
    expect(events[1]).toMatchObject({ jetonRoles: 'LicenseAssignment.Read.All,User.Read.All', jetonNbRoles: 2 });
    expect(JSON.stringify(events)).not.toContain(a);
    expect(latestTokenInfo()?.roles).toEqual(['LicenseAssignment.Read.All', 'User.Read.All']);
  });

  it('warmUp obtient un jeton au démarrage ; un échec est tracé sans empêcher le démarrage', async () => {
    const ok = recorder();
    await createGraphClient(ok.audit, credentialOf(jwt({ roles: ['Sites.Selected'], iat: IAT }))).warmUp();
    expect(ok.events).toMatchObject([{ action: 'graph.jeton', outcome: 'ok', jetonRoles: 'Sites.Selected' }]);

    const ko = recorder();
    const broken: TokenCredential = { getToken: async () => Promise.reject(Object.assign(new Error('secret détail'), { name: 'CredentialUnavailableError' })) };
    await expect(createGraphClient(ko.audit, broken).warmUp()).resolves.toBeUndefined();
    expect(ko.events).toEqual([{ action: 'graph.jeton', outcome: 'erreur', code: 'CredentialUnavailableError' }]);
  });
});
