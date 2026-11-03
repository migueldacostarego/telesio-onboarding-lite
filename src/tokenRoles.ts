/**
 * Rôles (noms seulement) du dernier jeton Graph obtenu : sert à diagnostiquer un 403 (rôle absent du jeton ou jeton périmé).
 * Le jeton lui-même n'est jamais conservé ni journalisé ; seules les revendications `roles`, `wids`, `iat` et `exp` sont lues.
 */
export interface TokenInfo {
  roles: string[];
  /** Rôles d'annuaire (identifiants de modèle, `wids`) : User Administrator limité à l'unité des comptes d'onboarding, par exemple. */
  wids?: string[];
  /** Instants d'émission et d'expiration (ISO 8601), si présents dans le jeton. */
  issuedAt?: string;
  expiresAt?: string;
}

let latest: TokenInfo | undefined;

const iso = (seconds: unknown): string | undefined => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : undefined);

/** Lit roles/wids/iat/exp dans la charge utile d'un JWT (sans vérifier la signature : simple observation). */
export function decodeTokenInfo(jwt: string): TokenInfo | undefined {
  const payload = jwt.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { roles?: unknown; wids?: unknown; iat?: unknown; exp?: unknown };
    const chaines = (v: unknown) => (Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string').sort() : []);
    const wids = chaines(claims.wids);
    return { roles: chaines(claims.roles), ...(wids.length > 0 ? { wids } : {}), issuedAt: iso(claims.iat), expiresAt: iso(claims.exp) };
  } catch {
    return undefined;
  }
}

export function recordTokenInfo(info: TokenInfo | undefined): void {
  latest = info;
}

export function latestTokenInfo(): TokenInfo | undefined {
  return latest;
}

/** Propriétés d'audit décrivant un jeton : liste des rôles (noms), rôles d'annuaire (identifiants de modèle) et dates, jamais le jeton. */
export function tokenAuditProps(info: TokenInfo | undefined): Record<string, string | number> {
  if (!info) return { jetonRoles: 'inconnu' };
  return {
    jetonRoles: info.roles.join(',') || 'aucun',
    jetonNbRoles: info.roles.length,
    ...(info.wids ? { jetonWids: info.wids.join(',') } : {}),
    ...(info.issuedAt ? { jetonEmisA: info.issuedAt } : {}),
    ...(info.expiresAt ? { jetonExpireA: info.expiresAt } : {}),
  };
}
