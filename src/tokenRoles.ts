/**
 * Rôles (noms seulement) du dernier jeton Graph obtenu : sert à diagnostiquer un 403 (rôle absent du jeton ou jeton périmé).
 * Le jeton lui-même n'est jamais conservé ni journalisé ; seules les revendications `roles`, `iat` et `exp` sont lues.
 */
export interface TokenInfo {
  roles: string[];
  /** Instants d'émission et d'expiration (ISO 8601), si présents dans le jeton. */
  issuedAt?: string;
  expiresAt?: string;
}

let latest: TokenInfo | undefined;

const iso = (seconds: unknown): string | undefined => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : undefined);

/** Lit roles/iat/exp dans la charge utile d'un JWT (sans vérifier la signature : simple observation). */
export function decodeTokenInfo(jwt: string): TokenInfo | undefined {
  const payload = jwt.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { roles?: unknown; iat?: unknown; exp?: unknown };
    const roles = Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === 'string').sort() : [];
    return { roles, issuedAt: iso(claims.iat), expiresAt: iso(claims.exp) };
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

/** Propriétés d'audit décrivant un jeton : liste des rôles (noms) et dates, jamais le jeton. */
export function tokenAuditProps(info: TokenInfo | undefined): Record<string, string | number> {
  if (!info) return { jetonRoles: 'inconnu' };
  return {
    jetonRoles: info.roles.join(',') || 'aucun',
    jetonNbRoles: info.roles.length,
    ...(info.issuedAt ? { jetonEmisA: info.issuedAt } : {}),
    ...(info.expiresAt ? { jetonExpireA: info.expiresAt } : {}),
  };
}
