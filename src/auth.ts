import type { RequestHandler } from 'express';
import type { Audit } from './audit';

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
  /** Code d'erreur renvoyé à l'interface (corps de la réponse). */
  code?: string;
  /** Propriétés d'audit en plus (jamais de nom ni d'UPN). */
  extra?: Record<string, string>;
}

/** Authentifie via Easy Auth, puis applique `check` ; pose le principal dans res.locals. */
function guard(opts: GuardOpts, check: (p: Principal) => Promise<Denial | null>): RequestHandler {
  return async (req, res, next) => {
    const route = `${req.method} ${req.baseUrl}${req.path}`;
    const deny = (d: Denial, actor?: string) => {
      opts.audit.track({ action: 'acces.refuse', outcome: 'refuse', route, actor, reason: d.reason, ...d.extra });
      res.status(d.status).json({ error: d.error, ...(d.code ? { code: d.code } : {}) });
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

/**
 * Exige un droit de droitsDe (celui que GET /api/moi annonce à l'interface), calculé d'après les rôles du jeton.
 * Un refus est tracé (acces.refuse : route, objectId, droit manquant) et répond 403 { code: droit_manquant }.
 */
export function requireDroit(droit: keyof Droits, names: { rhRole: string; directionRole: string }, opts: GuardOpts): RequestHandler {
  return guard(opts, async (p) =>
    droitsDe(p.roles, names)[droit]
      ? null
      : { status: 403, error: 'Accès refusé', reason: 'droit_manquant', code: 'droit_manquant', extra: { droit } },
  );
}
