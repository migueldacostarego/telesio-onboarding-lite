import type { RequestHandler } from 'express';
import type { Audit } from './audit';
import type { Config } from './config';
import type { Directory } from './directory';

export interface Principal {
  /** objectId Entra de l'appelant. */
  id: string;
  roles: string[];
  /** Nom affiché (revendication `name`), absent si le jeton ne le porte pas. */
  name?: string;
  /** Email (`email`, à défaut le nom d'utilisateur `preferred_username`), absent si le jeton ne le porte pas. */
  email?: string;
}

const OID_TYPES = ['http://schemas.microsoft.com/identity/claims/objectidentifier', 'oid'];
const ROLE_TYPES = ['roles', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
const NAME_TYPES = ['name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'];
/** Par ordre de préférence : l'adresse de messagerie, à défaut le nom d'utilisateur (UPN). */
const EMAIL_TYPES = ['email', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'preferred_username', 'upn', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'];
const MAX_CLAIM_LENGTH = 256;

/** Première valeur non vide parmi les types de revendication, dans l'ordre donné. */
function firstClaim(claims: { typ: string; val: string }[], types: string[]): string | undefined {
  for (const typ of types) {
    const val = claims.find((c) => c.typ === typ && typeof c.val === 'string')?.val.trim();
    if (val) return val.slice(0, MAX_CLAIM_LENGTH);
  }
  return undefined;
}

/** Lit l'en-tête X-MS-CLIENT-PRINCIPAL posé (et écrasé) par App Service Easy Auth. */
export function parsePrincipal(header: string | undefined): Principal | null {
  if (!header) return null;
  try {
    const data = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
      claims?: { typ: string; val: string }[];
    };
    const claims = data.claims ?? [];
    const id = claims.find((c) => OID_TYPES.includes(c.typ))?.val;
    if (!id) return null;
    return {
      id,
      roles: claims.filter((c) => ROLE_TYPES.includes(c.typ)).map((c) => c.val),
      name: firstClaim(claims, NAME_TYPES),
      email: firstClaim(claims, EMAIL_TYPES),
    };
  } catch {
    return null;
  }
}

interface GuardOpts {
  trustHeaders: boolean;
  audit: Audit;
}

interface Denial {
  status: number;
  error: string;
  reason: string;
}

/** Authentifie via Easy Auth, puis applique `check` ; pose le principal dans res.locals. */
function guard(opts: GuardOpts, check: (p: Principal) => Promise<Denial | null>): RequestHandler {
  return async (req, res, next) => {
    const route = `${req.method} ${req.baseUrl}${req.path}`;
    const deny = (d: Denial, actor?: string) => {
      opts.audit.track({ action: 'acces.refuse', outcome: 'refuse', route, actor, reason: d.reason });
      res.status(d.status).json({ error: d.error });
    };
    if (!opts.trustHeaders) {
      // Sans Easy Auth, l'en-tête serait falsifiable : on refuse tout.
      deny({ status: 503, error: 'Authentification non configurée', reason: 'auth_non_configuree' });
      return;
    }
    const principal = parsePrincipal(req.header('x-ms-client-principal'));
    if (!principal) {
      deny({ status: 401, error: 'Authentification requise', reason: 'non_authentifie' });
      return;
    }
    const denial = await check(principal);
    if (denial) {
      deny(denial, principal.id);
      return;
    }
    res.locals.principal = principal;
    next();
  };
}

/** Ce que la personne peut faire dans l'application, déduit de ses rôles d'application. */
export interface Droits {
  /** Au moins un des trois droits suivants : sans lui, l'interface refuse l'accès. */
  acces: boolean;
  /** Saisir une demande d'onboarding : RH et Direction. */
  creer: boolean;
  /** Valider ou refuser une demande : Direction. */
  approuver: boolean;
  /** Activer un compte, régénérer le mot de passe, finaliser l'onboarding : RH. */
  activer: boolean;
}

/** Calculé côté serveur pour que l'interface n'ait aucun nom de rôle en dur (rh_role et direction_role sont configurables). */
export function droitsDe(roles: readonly string[], names: { rhRole: string; directionRole: string }): Droits {
  const rh = roles.includes(names.rhRole);
  const direction = roles.includes(names.directionRole);
  const creer = rh || direction;
  const approuver = direction;
  const activer = rh;
  return { acces: creer || approuver || activer, creer, approuver, activer };
}

/** Toute personne connectée (Easy Auth), sans rôle : pour dire à l'interface qui est connecté et ce qu'elle peut faire. */
export function requireAuthenticated(opts: GuardOpts): RequestHandler {
  return guard(opts, async () => null);
}

export function requireRole(role: string, opts: GuardOpts): RequestHandler {
  return guard(opts, async (p) =>
    p.roles.includes(role) ? null : { status: 403, error: 'Accès refusé', reason: 'role_manquant' },
  );
}

/** Valideur : la personne DIRECTION_OBJECT_ID, ou un membre (transitif) du groupe DIRECTION_OBJECT_ID. */
export function requireDirection(
  direction: Config['direction'],
  directory: Pick<Directory, 'isMemberOfGroup'>,
  opts: GuardOpts,
): RequestHandler {
  return guard(opts, async (p) => {
    const { type, objectId } = direction;
    if (!type || !objectId) {
      return { status: 503, error: 'Direction non configurée', reason: 'direction_non_configuree' };
    }
    const denied: Denial = { status: 403, error: 'Accès refusé', reason: 'direction_non_valideur' };
    if (type === 'user') return p.id.toLowerCase() === objectId.toLowerCase() ? null : denied;
    try {
      return (await directory.isMemberOfGroup(p.id, objectId)) ? null : denied;
    } catch {
      // Fail closed : impossible de vérifier l'appartenance.
      return { status: 503, error: 'Vérification d’appartenance impossible', reason: 'direction_verification_echec' };
    }
  });
}
