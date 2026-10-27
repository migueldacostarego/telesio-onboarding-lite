import type { Client } from '@microsoft/microsoft-graph-client';

export interface DirectoryUser {
  id: string;
  displayName: string;
  mail: string | null;
}

export type DirectoryErrorKind = 'notFound' | 'conflict' | 'other';

/** Erreur Graph réduite à ce qui est loggable : pas de message brut (il peut contenir des données). */
export class DirectoryError extends Error {
  constructor(
    public readonly kind: DirectoryErrorKind,
    public readonly statusCode: number | undefined,
    public readonly code: string | undefined,
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
}

/** Réponse Graph réduite aux champs utiles ; le secret n'existe que dans cet objet, jamais dans un log. */
export interface TapResult {
  temporaryAccessPass: string;
  lifetimeInMinutes: number;
  startDateTime: string | null;
  isUsableOnce: boolean;
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

export interface Directory {
  /** hiredSince : AAAA-MM-JJ, ne garde que les arrivées à partir de cette date. */
  listByStatut(
    ext: string,
    statut: string,
    hiredSince?: string,
  ): Promise<{ demandes: PendingDemande[]; tronque: boolean }>;
  setAccountEnabled(id: string, enabled: boolean): Promise<void>;
  listTapIds(userId: string): Promise<string[]>;
  deleteTap(userId: string, tapId: string): Promise<void>;
  createTap(userId: string, lifetimeInMinutes: number): Promise<TapResult>;
  getOnboardingUser(id: string, ext: string): Promise<OnboardingUser | null>;
  deleteUser(id: string): Promise<void>;
  isMemberOfGroup(userId: string, groupId: string): Promise<boolean>;
  search(q: string): Promise<DirectoryUser[]>;
  getUser(id: string): Promise<{ id: string; accountEnabled: boolean } | null>;
  upnTaken(upn: string): Promise<boolean>;
  createUser(user: NewUser): Promise<string>;
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
  return new DirectoryError(kind, status, e.code);
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

  async createUser(user: NewUser): Promise<string> {
    try {
      const res = await this.client.api('/users').post(user);
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
    // `ext` est validé à la config, `statut` vient de STATUTS, `hiredSince` d'un calcul de date : sûrs dans le filtre.
    const since = hiredSince ? ` and employeeHireDate ge ${hiredSince}T00:00:00Z` : '';
    try {
      const res = await this.client
        .api('/users')
        .header(...EVENTUAL)
        .filter(`${ext} eq '${statut}'${since}`)
        .select('id,displayName,jobTitle,department,employeeHireDate')
        .expand('manager($select=id,displayName)')
        .top(100)
        .count(true)
        .get();
      const demandes = ((res?.value ?? []) as RawPending[]).map((u) => ({
        id: u.id,
        nom: u.displayName,
        poste: u.jobTitle ?? null,
        service: u.department ?? null,
        manager: u.manager ? { id: u.manager.id, displayName: u.manager.displayName } : null,
        dateArrivee: typeof u.employeeHireDate === 'string' ? u.employeeHireDate.slice(0, 10) : null,
      }));
      return { demandes, tronque: Boolean(res?.['@odata.nextLink']) };
    } catch (err) {
      throw wrap(err);
    }
  }

  async getOnboardingUser(id: string, ext: string): Promise<OnboardingUser | null> {
    try {
      const u = await this.client
        .api(`/users/${id}`)
        .select(`id,displayName,givenName,surname,accountEnabled,employeeHireDate,${ext}`)
        .get();
      return {
        id: u.id as string,
        displayName: u.displayName as string,
        givenName: (u.givenName ?? null) as string | null,
        surname: (u.surname ?? null) as string | null,
        accountEnabled: u.accountEnabled !== false,
        statut: typeof u[ext] === 'string' ? (u[ext] as string) : null,
        dateArrivee: typeof u.employeeHireDate === 'string' ? u.employeeHireDate.slice(0, 10) : null,
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

  async listTapIds(userId: string): Promise<string[]> {
    try {
      const res = await this.client.api(`/users/${userId}/authentication/temporaryAccessPassMethods`).get();
      return ((res?.value ?? []) as { id: string }[]).map((m) => m.id);
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

  async createTap(userId: string, lifetimeInMinutes: number): Promise<TapResult> {
    try {
      const res = await this.client
        .api(`/users/${userId}/authentication/temporaryAccessPassMethods`)
        .post({ isUsableOnce: true, lifetimeInMinutes });
      // Le TAP n'est lisible qu'à la création ; on ne renvoie que les champs utiles.
      return {
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
