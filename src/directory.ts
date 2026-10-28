import type { Client } from '@microsoft/microsoft-graph-client';
import { latestTokenInfo, tokenAuditProps } from './tokenRoles';

export interface DirectoryUser {
  id: string;
  displayName: string;
  mail: string | null;
}

export type DirectoryErrorKind = 'notFound' | 'conflict' | 'other';

/**
 * Message Graph rendu loggable : les UPN/emails et tout texte entre guillemets (noms, valeurs de propriétés)
 * sont masqués, la longueur est bornée. Les GUID (objectId) sont conservés.
 */
export function sanitizeGraphMessage(message: unknown): string | undefined {
  if (typeof message !== 'string' || message.trim() === '') return undefined;
  return message
    .replace(/[^\s'"<>]+@[^\s'"<>]+/g, '[email]')
    .replace(/'[^']*'|"[^"]*"|‘[^’]*’|“[^”]*”/g, '[valeur]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * Propriétés d'audit d'un échec Graph : statut, code, message assaini et, pour un 403, les rôles (noms) du dernier
 * jeton obtenu (rôle absent du jeton ou jeton périmé ?).
 */
export function graphFailureProps(err: unknown): Record<string, string | number | undefined> {
  const e = err instanceof DirectoryError ? err : undefined;
  return {
    http: e?.statusCode,
    code: e?.code,
    graphMessage: e?.detail,
    ...(e?.statusCode === 403 ? tokenAuditProps(latestTokenInfo()) : {}),
  };
}

/** Erreur Graph réduite à ce qui est loggable : statut, code et message assaini (sans nom ni UPN). */
export class DirectoryError extends Error {
  constructor(
    public readonly kind: DirectoryErrorKind,
    public readonly statusCode: number | undefined,
    public readonly code: string | undefined,
    /** error.message de Graph, assaini par sanitizeGraphMessage. */
    public readonly detail?: string,
  ) {
    super(`Graph ${statusCode ?? '?'} ${code ?? ''}`.trim());
  }
}

export interface NewUser {
  accountEnabled: false;
  displayName: string;
  givenName: string;
  surname: string;
  userPrincipalName: string;
  mailNickname: string;
  employeeHireDate: string;
  jobTitle: string;
  department: string;
  /** Requis pour qu'Entra attribue une licence (licence par groupe). */
  usageLocation: string;
  passwordProfile: { password: string; forceChangePasswordNextSignIn: boolean };
}

export interface OnboardingUser {
  id: string;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  accountEnabled: boolean;
  /** Valeur brute de l'attribut d'extension ; null si absent (compte hors onboarding). */
  statut: string | null;
  /** AAAA-MM-JJ (employeeHireDate) ; null si absente. */
  dateArrivee: string | null;
  /** skuId choisi par RH (extension licenceOnboarding) ; null si absent (demande antérieure au choix de licence). */
  licence: string | null;
}

/** Réponse Graph réduite aux champs utiles ; le secret n'existe que dans cet objet, jamais dans un log. */
export interface TapResult {
  /** Identifiant du TAP créé (Graph le renvoie) : permet de ne pas supprimer le nouveau en nettoyant l'ancien. */
  id?: string;
  temporaryAccessPass: string;
  lifetimeInMinutes: number;
  startDateTime: string | null;
  isUsableOnce: boolean;
}

/** TAP existant (liste Graph : jamais le secret). Un utilisateur n'en a qu'un. */
export interface TapInfo {
  id: string;
  isUsable: boolean;
  /** NotYetValid (début dans le futur), Expired, OneTimeUsed, etc. */
  methodUsabilityReason: string | null;
  startDateTime: string | null;
  lifetimeInMinutes: number | null;
}

/** Données lues pour décider si l'onboarding est terminé. */
export interface OnboardingProgress {
  /** lastPasswordChangeDateTime (création du mot de passe, ou dernier changement) ; null si absent. */
  lastPasswordChange: string | null;
  /** Date d'activation (extension) ; null pour un compte activé avant l'extension. */
  activation: string | null;
  /** Création du compte : repli quand l'extension est absente (le mot de passe initial date de la création). */
  createdDateTime: string | null;
}

export interface PendingDemande {
  id: string;
  nom: string;
  poste: string | null;
  service: string | null;
  manager: { id: string; displayName: string } | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
}

/** Disponibilité d'un SKU : prepaidUnits.enabled et consumedUnits de GET /subscribedSkus. */
export interface SkuAvailability {
  enabled: number;
  consumed: number;
}

/** Entrée licenseAssignmentStates de l'utilisateur pour un SKU (null : pas encore traitée par Entra). */
export interface LicenseState {
  /** Active, ActiveWithError, Disabled, Error. */
  state: string;
  /** CountViolation, MutuallyExclusiveViolation, DependencyViolation, ProhibitedInUsageLocationViolation, UniquenessViolation, Other ; null si aucune. */
  error: string | null;
  /** Id du groupe qui porte la licence ; null si attribuée directement. */
  assignedByGroup: string | null;
}

/** Lecture de licenseAssignmentStates : l'entrée du SKU (null si absente) et le nombre total d'entrées de l'utilisateur. */
export interface LicenseRead {
  entry: LicenseState | null;
  total: number;
}

export interface Directory {
  /** GET /subscribedSkus : unités par skuId (en minuscules). Un SKU absent du tenant n'y figure pas. */
  listSkuAvailability(): Promise<Map<string, SkuAvailability>>;
  /** GET /users/{id}?$select=id,licenseAssignmentStates ; l'entrée est retrouvée par skuId (sans tenir compte de la casse). */
  readLicenseStates(userId: string, skuId: string): Promise<LicenseRead>;
  /** Idempotent : un utilisateur déjà membre n'est pas une erreur. */
  addGroupMember(groupId: string, userId: string): Promise<void>;
  /** Idempotent : un utilisateur absent du groupe n'est pas une erreur. */
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  /** hiredSince : AAAA-MM-JJ, ne garde que les arrivées à partir de cette date. */
  listByStatut(
    ext: string,
    statut: string,
    hiredSince?: string,
  ): Promise<{ demandes: PendingDemande[]; tronque: boolean }>;
  setAccountEnabled(id: string, enabled: boolean): Promise<void>;
  listTaps(userId: string): Promise<TapInfo[]>;
  deleteTap(userId: string, tapId: string): Promise<void>;
  /** TAP multi-usage (isUsableOnce false), utilisable à partir de startDateTime. */
  createTap(userId: string, opts: { lifetimeInMinutes: number; startDateTime: string }): Promise<TapResult>;
  /** GET /users/{id}?$select=lastPasswordChangeDateTime,createdDateTime,<extension d'activation>. */
  getOnboardingProgress(userId: string, activationExt: string): Promise<OnboardingProgress>;
  /** GET /users/{id}/authentication/microsoftAuthenticatorMethods : au moins une inscription. */
  hasAuthenticator(userId: string): Promise<boolean>;
  /** licenseExt : nom de l'extension qui porte le skuId choisi (lue en plus du statut). */
  getOnboardingUser(id: string, ext: string, licenseExt?: string): Promise<OnboardingUser | null>;
  deleteUser(id: string): Promise<void>;
  isMemberOfGroup(userId: string, groupId: string): Promise<boolean>;
  search(q: string): Promise<DirectoryUser[]>;
  getUser(id: string): Promise<{ id: string; accountEnabled: boolean } | null>;
  upnTaken(upn: string): Promise<boolean>;
  /** extensions : attributs d'extension (nom complet -> valeur) posés à la création. */
  createUser(user: NewUser, extensions?: Record<string, string>): Promise<string>;
  setManager(userId: string, managerId: string): Promise<void>;
  setExtension(userId: string, name: string, value: string): Promise<void>;
}

interface GraphErrorLike {
  statusCode?: number;
  code?: string;
  message?: string;
}

export function wrap(err: unknown): DirectoryError {
  const e = (err ?? {}) as GraphErrorLike;
  const status = e.statusCode;
  const conflict =
    (status === 409 || status === 400) && /already ?exists|ObjectConflict/i.test(`${e.code ?? ''} ${e.message ?? ''}`);
  const kind: DirectoryErrorKind = status === 404 ? 'notFound' : conflict ? 'conflict' : 'other';
  return new DirectoryError(kind, status, e.code, sanitizeGraphMessage(e.message));
}

interface RawPending {
  id: string;
  displayName: string;
  jobTitle?: string | null;
  department?: string | null;
  employeeHireDate?: string | null;
  manager?: { id: string; displayName: string } | null;
}

const quote = (s: string) => s.replace(/'/g, "''");
const EVENTUAL = ['ConsistencyLevel', 'eventual'] as const;
/** Pages de 100 suivies au plus par liste : au-delà, la réponse est marquée tronquée. */
const MAX_PAGES = 10;

export class GraphDirectory implements Directory {
  constructor(private readonly client: Pick<Client, 'api'>) {}

  async search(q: string): Promise<DirectoryUser[]> {
    // Les guillemets et antislashs sont retirés : ils sortiraient de la chaîne $search.
    const term = q.replace(/["\\]/g, '');
    try {
      const res = await this.client
        .api('/users')
        .header(...EVENTUAL)
        .search(`"displayName:${term}" OR "mail:${term}"`)
        .filter('accountEnabled eq true')
        .select('id,displayName,mail')
        .top(10)
        .count(true)
        .get();
      return ((res?.value ?? []) as DirectoryUser[]).map((u) => ({
        id: u.id,
        displayName: u.displayName,
        mail: u.mail ?? null,
      }));
    } catch (err) {
      throw wrap(err);
    }
  }

  async getUser(id: string) {
    try {
      const u = await this.client.api(`/users/${id}`).select('id,accountEnabled').get();
      return { id: u.id as string, accountEnabled: u.accountEnabled !== false };
    } catch (err) {
      const e = wrap(err);
      if (e.kind === 'notFound') return null;
      throw e;
    }
  }

  async upnTaken(upn: string): Promise<boolean> {
    const v = quote(upn);
    try {
      const res = await this.client
        .api('/users')
        .header(...EVENTUAL)
        .filter(`userPrincipalName eq '${v}' or mail eq '${v}' or proxyAddresses/any(p:p eq 'smtp:${v}')`)
        .select('id')
        .top(1)
        .count(true)
        .get();
      return ((res?.value ?? []) as unknown[]).length > 0;
    } catch (err) {
      throw wrap(err);
    }
  }

  async createUser(user: NewUser, extensions: Record<string, string> = {}): Promise<string> {
    try {
      // Les attributs d'extension sont posés dans le même POST : pas d'état intermédiaire sans statut.
      const res = await this.client.api('/users').post({ ...user, ...extensions });
      return res.id as string;
    } catch (err) {
      throw wrap(err);
    }
  }

  async setManager(userId: string, managerId: string): Promise<void> {
    try {
      await this.client
        .api(`/users/${userId}/manager/$ref`)
        .put({ '@odata.id': `https://graph.microsoft.com/v1.0/users/${managerId}` });
    } catch (err) {
      throw wrap(err);
    }
  }

  async setExtension(userId: string, name: string, value: string): Promise<void> {
    try {
      await this.client.api(`/users/${userId}`).patch({ [name]: value });
    } catch (err) {
      throw wrap(err);
    }
  }

  async listByStatut(ext: string, statut: string, hiredSince?: string) {
    // `ext` est validé à la config, `statut` vient de STATUTS : sûrs dans le filtre.
    // Graph refuse (400 Request_UnsupportedQuery) statut + employeeHireDate combinés à $expand=manager :
    // il ne filtre que sur le statut, et la date (hiredSince) est filtrée ici, après lecture des pages.
    try {
      let req = this.client
        .api('/users')
        .header(...EVENTUAL)
        .filter(`${ext} eq '${statut}'`)
        .select('id,displayName,jobTitle,department,employeeHireDate')
        .expand('manager($select=id,displayName)')
        .top(100)
        .count(true);
      const raw: RawPending[] = [];
      let tronque = false;
      for (let page = 1; ; page++) {
        const res = await req.get();
        raw.push(...((res?.value ?? []) as RawPending[]));
        const next = res?.['@odata.nextLink'] as string | undefined;
        if (!next) break;
        if (page >= MAX_PAGES) {
          tronque = true;
          break;
        }
        req = this.client.api(next).header(...EVENTUAL);
      }
      const demandes = raw
        .map((u) => ({
          id: u.id,
          nom: u.displayName,
          poste: u.jobTitle ?? null,
          service: u.department ?? null,
          manager: u.manager ? { id: u.manager.id, displayName: u.manager.displayName } : null,
          dateArrivee: typeof u.employeeHireDate === 'string' ? u.employeeHireDate.slice(0, 10) : null,
        }))
        .filter((d) => !hiredSince || (d.dateArrivee !== null && d.dateArrivee >= hiredSince));
      return { demandes, tronque };
    } catch (err) {
      throw wrap(err);
    }
  }

  async getOnboardingUser(id: string, ext: string, licenseExt?: string): Promise<OnboardingUser | null> {
    try {
      const u = await this.client
        .api(`/users/${id}`)
        .select(`id,displayName,givenName,surname,accountEnabled,employeeHireDate,${ext}${licenseExt ? `,${licenseExt}` : ''}`)
        .get();
      return {
        id: u.id as string,
        displayName: u.displayName as string,
        givenName: (u.givenName ?? null) as string | null,
        surname: (u.surname ?? null) as string | null,
        accountEnabled: u.accountEnabled !== false,
        statut: typeof u[ext] === 'string' ? (u[ext] as string) : null,
        dateArrivee: typeof u.employeeHireDate === 'string' ? u.employeeHireDate.slice(0, 10) : null,
        licence: licenseExt && typeof u[licenseExt] === 'string' ? (u[licenseExt] as string).toLowerCase() : null,
      };
    } catch (err) {
      const e = wrap(err);
      if (e.kind === 'notFound') return null;
      throw e;
    }
  }

  /** Suppression logique : le compte reste récupérable 30 jours dans la corbeille Entra. */
  async deleteUser(id: string): Promise<void> {
    try {
      await this.client.api(`/users/${id}`).delete();
    } catch (err) {
      throw wrap(err);
    }
  }

  async listSkuAvailability(): Promise<Map<string, SkuAvailability>> {
    try {
      const res = await this.client.api('/subscribedSkus').get();
      const out = new Map<string, SkuAvailability>();
      for (const s of (res?.value ?? []) as { skuId?: string; consumedUnits?: number; prepaidUnits?: { enabled?: number } }[]) {
        if (s.skuId) out.set(s.skuId.toLowerCase(), { enabled: s.prepaidUnits?.enabled ?? 0, consumed: s.consumedUnits ?? 0 });
      }
      return out;
    } catch (err) {
      throw wrap(err);
    }
  }

  async readLicenseStates(userId: string, skuId: string): Promise<LicenseRead> {
    try {
      const u = await this.client.api(`/users/${userId}`).select('id,licenseAssignmentStates').get();
      const states = (u?.licenseAssignmentStates ?? []) as {
        skuId?: string;
        state?: string;
        error?: string | null;
        assignedByGroup?: string | null;
      }[];
      const own = states.filter((s) => s.skuId?.toLowerCase() === skuId.toLowerCase());
      if (own.length === 0) return { entry: null, total: states.length };
      // Graph renvoie error = "None" (et non null) pour une entrée sans erreur.
      const erreur = (x: { error?: string | null }) => (x.error && x.error !== 'None' ? x.error : null);
      // Plusieurs entrées possibles (directe et par groupe) : une entrée sans erreur l'emporte.
      const s = own.find((x) => x.state === 'Active' && !erreur(x)) ?? own[0]!;
      return { entry: { state: s.state ?? 'Error', error: erreur(s), assignedByGroup: s.assignedByGroup ?? null }, total: states.length };
    } catch (err) {
      throw wrap(err);
    }
  }

  async addGroupMember(groupId: string, userId: string): Promise<void> {
    try {
      await this.client
        .api(`/groups/${groupId}/members/$ref`)
        .post({ '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      // Graph répond 400 « One or more added object references already exist » si l'utilisateur est déjà membre.
      if (e?.statusCode === 400 && /already exist/i.test(e.message ?? '')) return;
      throw wrap(err);
    }
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    try {
      await this.client.api(`/groups/${groupId}/members/${userId}/$ref`).delete();
    } catch (err) {
      const e = wrap(err);
      if (e.kind === 'notFound') return;
      throw e;
    }
  }

  async isMemberOfGroup(userId: string, groupId: string): Promise<boolean> {
    try {
      const res = await this.client.api(`/users/${userId}/checkMemberGroups`).post({ groupIds: [groupId] });
      return ((res?.value ?? []) as string[]).some((g) => g.toLowerCase() === groupId.toLowerCase());
    } catch (err) {
      throw wrap(err);
    }
  }

  async setAccountEnabled(id: string, enabled: boolean): Promise<void> {
    try {
      await this.client.api(`/users/${id}`).patch({ accountEnabled: enabled });
    } catch (err) {
      throw wrap(err);
    }
  }

  async listTaps(userId: string): Promise<TapInfo[]> {
    try {
      const res = await this.client.api(`/users/${userId}/authentication/temporaryAccessPassMethods`).get();
      return ((res?.value ?? []) as Record<string, unknown>[]).map((m) => ({
        id: m.id as string,
        isUsable: m.isUsable === true,
        methodUsabilityReason: typeof m.methodUsabilityReason === 'string' ? m.methodUsabilityReason : null,
        startDateTime: typeof m.startDateTime === 'string' ? m.startDateTime : null,
        lifetimeInMinutes: typeof m.lifetimeInMinutes === 'number' ? m.lifetimeInMinutes : null,
      }));
    } catch (err) {
      throw wrap(err);
    }
  }

  async getOnboardingProgress(userId: string, activationExt: string): Promise<OnboardingProgress> {
    try {
      const u = await this.client.api(`/users/${userId}`).select(`id,lastPasswordChangeDateTime,createdDateTime,${activationExt}`).get();
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      return { lastPasswordChange: str(u.lastPasswordChangeDateTime), activation: str(u[activationExt]), createdDateTime: str(u.createdDateTime) };
    } catch (err) {
      throw wrap(err);
    }
  }

  async hasAuthenticator(userId: string): Promise<boolean> {
    try {
      const res = await this.client.api(`/users/${userId}/authentication/microsoftAuthenticatorMethods`).get();
      return ((res?.value ?? []) as unknown[]).length > 0;
    } catch (err) {
      throw wrap(err);
    }
  }

  async deleteTap(userId: string, tapId: string): Promise<void> {
    try {
      await this.client.api(`/users/${userId}/authentication/temporaryAccessPassMethods/${tapId}`).delete();
    } catch (err) {
      throw wrap(err);
    }
  }

  async createTap(userId: string, opts: { lifetimeInMinutes: number; startDateTime: string }): Promise<TapResult> {
    try {
      const res = await this.client
        .api(`/users/${userId}/authentication/temporaryAccessPassMethods`)
        .post({ isUsableOnce: false, lifetimeInMinutes: opts.lifetimeInMinutes, startDateTime: opts.startDateTime });
      // Le TAP n'est lisible qu'à la création ; on ne renvoie que les champs utiles.
      return {
        id: typeof res.id === 'string' ? res.id : undefined,
        temporaryAccessPass: res.temporaryAccessPass as string,
        lifetimeInMinutes: res.lifetimeInMinutes as number,
        startDateTime: (res.startDateTime ?? null) as string | null,
        isUsableOnce: res.isUsableOnce === true,
      };
    } catch (err) {
      throw wrap(err);
    }
  }
}
