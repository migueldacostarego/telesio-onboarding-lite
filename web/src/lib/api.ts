/**
 * Client de l'API Express (/api) : fetch same-origin, JSON uniquement.
 *
 * - 2xx : `{ kind: 'ok' }`. Le 202 n'est pas une erreur (fetch le range pourtant dans `ok`) :
 *   `{ kind: 'en_cours' }`, avec le `code` du back (`licence_en_cours`).
 * - Autres statuts : `ApiError`, avec le `kind` (409 conflit, 502 amont, 503 indisponible…) et le
 *   `code`, `etape` et `raison` renvoyés par le back.
 * - Réponse non JSON ou redirection (Easy Auth, session expirée) : `kind: 'session'`.
 */

export type ApiErrorKind =
  | 'reseau' // fetch rejeté : réseau coupé
  | 'session' // redirection ou réponse non JSON : session Easy Auth expirée
  | 'invalide' // 400, 415, 422 : entrée refusée, détail par champ dans `details`
  | 'non_autorise' // 401, 403
  | 'introuvable' // 404
  | 'conflit' // 409 : état incompatible (statut, licence, action en cours…)
  | 'amont' // 502 : Graph ou SharePoint a échoué, `etape` dit où
  | 'indisponible' // 503 : fonction non configurée côté back
  | 'serveur'; // autre erreur 4xx ou 5xx

export interface ApiErrorInit {
  status: number;
  kind: ApiErrorKind;
  message: string;
  /** Code d'erreur du back (`licence_indisponible`, `action_en_cours`, `onboarding_non_termine`…). */
  code?: string;
  etape?: string;
  raison?: string;
  details?: Record<string, string>;
  /** objectId du compte éventuellement créé malgré l'échec (502 d'une création de demande). */
  id?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly code?: string;
  readonly etape?: string;
  readonly raison?: string;
  readonly details?: Record<string, string>;
  readonly id?: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.kind = init.kind;
    this.code = init.code;
    this.etape = init.etape;
    this.raison = init.raison;
    this.details = init.details;
    this.id = init.id;
  }
}

/** Corps d'un 202 : traitement en cours côté Entra, à rappeler plus tard. */
export interface EnCours {
  message: string;
  code: string;
  etape?: string;
}

export type ApiResult<T> =
  | { kind: 'ok'; status: number; data: T }
  | { kind: 'en_cours'; status: 202; data: EnCours };

export type ApiBody = Record<string, unknown>;

type Json = Record<string, unknown>;

const MESSAGES = {
  reseau: 'Réseau indisponible.',
  session: 'Session expirée ou réponse inattendue : rechargez la page.',
  serveur: 'Erreur du serveur.',
} as const;

function kindOf(status: number): ApiErrorKind {
  if (status === 400 || status === 415 || status === 422) return 'invalide';
  if (status === 401 || status === 403) return 'non_autorise';
  if (status === 404) return 'introuvable';
  if (status === 409) return 'conflit';
  if (status === 502) return 'amont';
  if (status === 503) return 'indisponible';
  return 'serveur';
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function detailsOf(v: unknown): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const entries = Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Corps JSON, ou `undefined` si la réponse n'en est pas un (page HTML d'Easy Auth, passerelle). */
async function readJson(res: Response): Promise<unknown> {
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return undefined;
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

const asObject = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});

export async function request<T>(method: string, path: string, body?: ApiBody): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      // « manual » : une redirection Easy Auth (session expirée) est reconnue, pas suivie vers un autre domaine.
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        // Le back refuse toute écriture qui n'est pas du JSON (415) : corps `{}` par défaut.
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError({ status: 0, kind: 'reseau', message: MESSAGES.reseau });
  }

  if (res.type === 'opaqueredirect') {
    throw new ApiError({ status: 0, kind: 'session', message: MESSAGES.session });
  }
  const payload = await readJson(res);
  if (payload === undefined) {
    // Une réponse sans JSON n'est pas une réponse de l'API : page de connexion Easy Auth ou passerelle.
    throw new ApiError(
      res.ok
        ? { status: res.status, kind: 'session', message: MESSAGES.session }
        : { status: res.status, kind: kindOf(res.status), message: MESSAGES.serveur },
    );
  }
  const json = asObject(payload);

  // 202 avant `res.ok` : le corps porte `message` et `code`, pas `error`.
  if (res.status === 202) {
    return {
      kind: 'en_cours',
      status: 202,
      data: { message: str(json.message) ?? '', code: str(json.code) ?? '', etape: str(json.etape) },
    };
  }
  // Un succès peut être un tableau (GET /api/annuaire).
  if (res.ok) return { kind: 'ok', status: res.status, data: payload as T };

  throw new ApiError({
    status: res.status,
    kind: kindOf(res.status),
    message: str(json.error) ?? str(json.message) ?? MESSAGES.serveur,
    code: str(json.code),
    etape: str(json.etape),
    raison: str(json.raison),
    details: detailsOf(json.details),
    id: str(json.id),
  });
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: ApiBody) => request<T>('POST', path, body),
};
