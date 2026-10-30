import type { Client } from '@microsoft/microsoft-graph-client';
import { latestTokenInfo, tokenAuditProps } from './tokenRoles';
import { typeLu, type TypeContrat } from './typeContrat';

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
  /** Type de contrat (« Employé », « Contractor ») : attribut natif d'Entra, lisible dans le portail. */
  employeeType: string;
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
  /** objectId du créateur de la demande (extension createurOnboarding) ; null si absent (demande antérieure ou extension non lue). Sert à tracer l'auto-approbation. */
  createur: string | null;
  /** Valeurs brutes des extensions demandées en plus (`extra`) ; null si absentes. */
  extensions: Record<string, string | null>;
}

/** Compte d'onboarding lu pour la page de détail (GET /api/demandes/:id) : une seule requête, manager inclus. */
export interface DemandeLue {
  id: string;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  upn: string | null;
  poste: string | null;
  service: string | null;
  /** employeeType, si c'est un type connu ; null pour un compte antérieur au formulaire par type. */
  typeContrat: TypeContrat | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
  createdDateTime: string | null;
  lastPasswordChange: string | null;
  accountEnabled: boolean;
  managerNom: string | null;
  /** Valeurs brutes des extensions demandées ; null si absentes. */
  extensions: Record<string, string | null>;
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
  /** Adresse professionnelle du compte (userPrincipalName) ; null si Graph ne la renvoie pas. */
  upn: string | null;
  poste: string | null;
  service: string | null;
  /** employeeType, si c'est un type connu ; null pour un compte antérieur au formulaire par type. */
  typeContrat: TypeContrat | null;
  manager: { id: string; displayName: string } | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
  /** Prénom et nom de famille (nom du dossier SharePoint), présents seulement si la liste les a demandés (`withNames`) ; jamais renvoyés tels quels par l'API. */
  prenom?: string | null;
  famille?: string | null;
  /** Valeurs brutes des extensions lues en plus (`extras` de `listByStatut`) ; null si absentes. Jamais renvoyées telles quelles par l'API. */
  extensions?: Record<string, string | null>;
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
    withNames?: boolean,
    /** Extensions à lire dans la même requête (`$select`), rendues dans `extensions`. */
    extras?: readonly string[],
  ): Promise<{ demandes: PendingDemande[]; tronque: boolean }>;
  setAccountEnabled(id: string, enabled: boolean): Promise<void>;
  /** Mot de passe temporaire : Entra impose son changement à la première connexion (forceChangePasswordNextSignIn). */
  resetPassword(userId: string, password: string): Promise<void>;
  /** GET /users/{id}?$select=lastPasswordChangeDateTime,createdDateTime,<extension d'activation>. */
  getOnboardingProgress(userId: string, activationExt: string): Promise<OnboardingProgress>;
  /** GET /users/{id}/authentication/microsoftAuthenticatorMethods : au moins une inscription. */
  hasAuthenticator(userId: string): Promise<boolean>;
  /** licenseExt : extension qui porte le skuId choisi ; creatorExt : extension qui porte l'objectId du créateur ; extra : autres extensions à lire (lues en plus du statut). */
  getOnboardingUser(id: string, ext: string, licenseExt?: string, creatorExt?: string, extra?: readonly string[]): Promise<OnboardingUser | null>;
  /** GET /users/{id} avec le manager (`$expand`) et les extensions demandées ; null si le compte n'existe pas. */
  getDemande(id: string, extensions: readonly string[]): Promise<DemandeLue | null>;
  /** Nom affiché d'un compte ; null s'il n'existe plus (auteur supprimé). */
  getDisplayName(id: string): Promise<string | null>;
  /** GET /users/{id}/authentication/microsoftAuthenticatorMethods : une entrée par inscription (createdDateTime : null sans connexion sans mot de passe). */
  listAuthenticatorMethods(userId: string): Promise<{ createdDateTime: string | null }[]>;
  /** Plusieurs attributs dans le même PATCH : le statut et son auteur s'écrivent ensemble, jamais l'un sans l'autre. */
  setExtensions(userId: string, values: Record<string, string>): Promise<void>;
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
  /** Attributs d'extension demandés par $select (clé = nom complet). */
  [extension: string]: unknown;
  id: string;
  displayName: string;
  userPrincipalName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  employeeType?: string | null;
  employeeHireDate?: string | null;
  givenName?: string | null;
  surname?: string | null;
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

  async listByStatut(ext: string, statut: string, hiredSince?: string, withNames = false, extras: readonly string[] = []) {
    // `ext` est validé à la config, `statut` vient de STATUTS : sûrs dans le filtre.
    // Graph refuse (400 Request_UnsupportedQuery) statut + employeeHireDate combinés à $expand=manager :
    // il ne filtre que sur le statut, et la date (hiredSince) est filtrée ici, après lecture des pages.
    try {
      let req = this.client
        .api('/users')
        .header(...EVENTUAL)
        .filter(`${ext} eq '${statut}'`)
        .select(`id,displayName,userPrincipalName,jobTitle,department,employeeType,employeeHireDate${withNames ? ',givenName,surname' : ''}${extras.map((e) => `,${e}`).join('')}`)
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
          upn: typeof u.userPrincipalName === 'string' ? u.userPrincipalName : null,
          poste: u.jobTitle ?? null,
          service: u.department ?? null,
          typeContrat: typeLu(u.employeeType),
          manager: u.manager ? { id: u.manager.id, displayName: u.manager.displayName } : null,
          dateArrivee: typeof u.employeeHireDate === 'string' ? u.employeeHireDate.slice(0, 10) : null,
          ...(withNames ? { prenom: typeof u.givenName === 'string' ? u.givenName : null, famille: typeof u.surname === 'string' ? u.surname : null } : {}),
          ...(extras.length > 0 ? { extensions: Object.fromEntries(extras.map((e) => [e, typeof u[e] === 'string' ? (u[e] as string) : null])) } : {}),
        }))
        .filter((d) => !hiredSince || (d.dateArrivee !== null && d.dateArrivee >= hiredSince));
      return { demandes, tronque };
    } catch (err) {
      throw wrap(err);
    }
  }

  async getOnboardingUser(id: string, ext: string, licenseExt?: string, creatorExt?: string, extra: readonly string[] = []): Promise<OnboardingUser | null> {
    try {
      const u = await this.client
        .api(`/users/${id}`)
        .select(`id,displayName,givenName,surname,accountEnabled,employeeHireDate,${ext}${licenseExt ? `,${licenseExt}` : ''}${creatorExt ? `,${creatorExt}` : ''}${extra.map((e) => `,${e}`).join('')}`)
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
        createur: creatorExt && typeof u[creatorExt] === 'string' ? (u[creatorExt] as string) : null,
        extensions: Object.fromEntries(extra.map((e) => [e, typeof u[e] === 'string' ? (u[e] as string) : null])),
      };
    } catch (err) {
      const e = wrap(err);
      if (e.kind === 'notFound') return null;
      throw e;
    }
  }

  async getDemande(id: string, extensions: readonly string[]): Promise<DemandeLue | null> {
    try {
      const u = await this.client
        .api(`/users/${id}`)
        .select(`id,displayName,givenName,surname,userPrincipalName,jobTitle,department,employeeType,employeeHireDate,createdDateTime,lastPasswordChangeDateTime,accountEnabled${extensions.map((e) => `,${e}`).join('')}`)
        .expand('manager($select=id,displayName)')
        .get();
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        id: u.id as string,
        displayName: u.displayName as string,
        givenName: str(u.givenName),
        surname: str(u.surname),
        upn: str(u.userPrincipalName),
        poste: str(u.jobTitle),
        service: str(u.department),
        typeContrat: typeLu(u.employeeType),
        dateArrivee: typeof u.employeeHireDate === 'string' ? u.employeeHireDate.slice(0, 10) : null,
        createdDateTime: str(u.createdDateTime),
        lastPasswordChange: str(u.lastPasswordChangeDateTime),
        accountEnabled: u.accountEnabled !== false,
        managerNom: str(u.manager?.displayName),
        extensions: Object.fromEntries(extensions.map((e) => [e, str(u[e])])),
      };
    } catch (err) {
      const e = wrap(err);
      if (e.kind === 'notFound') return null;
      throw e;
    }
  }

  async getDisplayName(id: string): Promise<string | null> {
    try {
      const u = await this.client.api(`/users/${id}`).select('id,displayName').get();
      return typeof u.displayName === 'string' ? u.displayName : null;
    } catch (err) {
      const e = wrap(err);
      if (e.kind === 'notFound') return null;
      throw e;
    }
  }

  async setExtensions(userId: string, values: Record<string, string>): Promise<void> {
    try {
      await this.client.api(`/users/${userId}`).patch(values);
    } catch (err) {
      throw wrap(err);
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

  async resetPassword(userId: string, password: string): Promise<void> {
    try {
      await this.client.api(`/users/${userId}`).patch({ passwordProfile: { password, forceChangePasswordNextSignIn: true } });
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

  async listAuthenticatorMethods(userId: string): Promise<{ createdDateTime: string | null }[]> {
    try {
      const res = await this.client.api(`/users/${userId}/authentication/microsoftAuthenticatorMethods`).get();
      // Seule la date est gardée : jamais le nom de l'appareil.
      return ((res?.value ?? []) as { createdDateTime?: unknown }[]).map((m) => ({ createdDateTime: typeof m.createdDateTime === 'string' ? m.createdDateTime : null }));
    } catch (err) {
      throw wrap(err);
    }
  }

  async hasAuthenticator(userId: string): Promise<boolean> {
    return (await this.listAuthenticatorMethods(userId)).length > 0;
  }
}
