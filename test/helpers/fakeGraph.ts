import type { Client } from '@microsoft/microsoft-graph-client';

interface FakeUser {
  id: string;
  upn: string;
  accountEnabled: boolean;
  displayName: string;
  mail: string | null;
  manager?: string;
  props: Record<string, unknown>;
}

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  filter?: string;
  search?: string;
  body?: unknown;
}

/** Valeur du TAP renvoyée par le faux Graph : les tests vérifient qu'elle n'est jamais tracée. */
export const FAKE_TAP = 'Zx9!TapSecretValue42';

const graphError = (statusCode: number, code: string, message = '') => Object.assign(new Error(message), { statusCode, code });

/** Graph en mémoire : implémente juste ce que GraphDirectory appelle. */
export class FakeGraph {
  users = new Map<string, FakeUser>();
  calls: Call[] = [];
  /** Méthodes qui échouent : ex. failOn.put = 404 (manager pas encore répliqué). */
  failOn: {
    put?: number;
    patch?: number;
    post?: number;
    folder?: number;
    delete?: number;
    tapPost?: number;
    /** Échec des PATCH qui posent le statut (extension), pas de ceux d'accountEnabled. */
    statusPatch?: number;
  } = {};
  /** TAP existants par utilisateur : un seul autorisé, comme dans Entra. */
  taps = new Map<string, { id: string }[]>();
  private tapSeq = 0;
  /** groupId -> membres */
  groups = new Map<string, Set<string>>();
  /** Dossiers SharePoint : nom -> { id, folder? } (folder absent = c'est un fichier). */
  folders = new Map<string, { id: string; folder?: object }>();
  deleted: string[] = [];
  /** Nombre d'échecs PUT restants avant succès (réplication). */
  putFailuresLeft = 0;
  /** UPN existant mais invisible au 1er contrôle de disponibilité (course entre contrôle et création). */
  hiddenOnce = new Set<string>();
  private seq = 0;

  addUser(upn: string, displayName = 'Compte Test', accountEnabled = true): string {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.users.set(id, { id, upn, accountEnabled, displayName, mail: upn, props: {} });
    return id;
  }

  /** Compte d'onboarding tel que créé par POST /api/demandes. */
  addPending(ext: string, p: { givenName: string; surname: string; statut?: string; managerId?: string; hireDate?: string; enabled?: boolean }): string {
    const id = this.addUser(`${p.givenName}.${p.surname}@exemple.test`.toLowerCase(), `${p.givenName} ${p.surname}`, p.enabled ?? false);
    const u = this.users.get(id)!;
    u.props = {
      givenName: p.givenName,
      surname: p.surname,
      jobTitle: 'Comptable',
      department: 'Finance',
      employeeHireDate: `${p.hireDate ?? '2026-11-03'}T00:00:00Z`,
      [ext]: p.statut ?? 'EnAttente',
    };
    if (p.managerId) u.manager = `https://graph.microsoft.com/v1.0/users/${p.managerId}`;
    return id;
  }

  private managerOf(ref: string) {
    const m = this.users.get(ref.split('/').pop() as string);
    return m ? { id: m.id, displayName: m.displayName } : undefined;
  }

  asClient(): Pick<Client, 'api'> {
    return { api: (path: string) => this.request(path) } as unknown as Pick<Client, 'api'>;
  }

  private request(path: string) {
    const call: Call = { method: 'GET', path, headers: {} };
    const req = {
      header: (k: string, v: string) => ((call.headers[k] = v), req),
      filter: (f: string) => ((call.filter = f), req),
      search: (s: string) => ((call.search = s), req),
      select: () => req,
      expand: () => req,
      top: () => req,
      count: () => req,
      get: async () => this.handle(call),
      post: async (body: unknown) => this.handle({ ...call, method: 'POST', body }),
      put: async (body: unknown) => this.handle({ ...call, method: 'PUT', body }),
      patch: async (body: unknown) => this.handle({ ...call, method: 'PATCH', body }),
      delete: async () => this.handle({ ...call, method: 'DELETE' }),
    };
    return req;
  }

  private handle(call: Call): unknown {
    this.calls.push(call);
    const { method, path } = call;
    if (method === 'GET' && path === '/users') {
      if (call.search) {
        const term = /displayName:([^"]*)"/.exec(call.search)?.[1]?.toLowerCase() ?? '';
        const value = [...this.users.values()]
          .filter((u) => u.accountEnabled && u.displayName.toLowerCase().includes(term))
          .map((u) => ({ id: u.id, displayName: u.displayName, mail: u.mail }));
        return { value };
      }
      const ext = /(extension_\w+) eq '([^']+)'/.exec(call.filter ?? '');
      if (ext) {
        const since = /employeeHireDate ge (\d{4}-\d{2}-\d{2})/.exec(call.filter ?? '')?.[1];
        const value = [...this.users.values()]
          .filter((u) => u.props[ext[1] as string] === ext[2])
          .filter((u) => !since || String(u.props.employeeHireDate).slice(0, 10) >= since)
          .map((u) => ({
            id: u.id,
            displayName: u.displayName,
            jobTitle: u.props.jobTitle,
            department: u.props.department,
            employeeHireDate: u.props.employeeHireDate,
            manager: u.manager ? this.managerOf(u.manager) : undefined,
          }));
        return { value };
      }
      const upn = /userPrincipalName eq '([^']+)'/.exec(call.filter ?? '')?.[1];
      if (upn && this.hiddenOnce.delete(upn)) return { value: [] };
      return { value: [...this.users.values()].filter((u) => u.upn === upn).map((u) => ({ id: u.id })) };
    }
    const one = /^\/users\/([^/]+)$/.exec(path);
    if (method === 'GET' && one) {
      const u = this.users.get(one[1] as string);
      if (!u) throw graphError(404, 'Request_ResourceNotFound');
      const ext = Object.fromEntries(Object.entries(u.props).filter(([k]) => k.startsWith('extension_')));
      return {
        id: u.id,
        accountEnabled: u.accountEnabled,
        displayName: u.displayName,
        givenName: u.props.givenName,
        surname: u.props.surname,
        employeeHireDate: u.props.employeeHireDate,
        ...ext,
      };
    }
    if (method === 'DELETE' && one) {
      if (this.failOn.delete) throw graphError(this.failOn.delete, 'Authorization_RequestDenied');
      this.users.delete(one[1] as string);
      this.deleted.push(one[1] as string);
      return undefined;
    }
    const tapList = /^\/users\/([^/]+)\/authentication\/temporaryAccessPassMethods$/.exec(path);
    if (tapList && method === 'GET') {
      // Comme Graph : la liste ne contient jamais le secret.
      return { value: (this.taps.get(tapList[1] as string) ?? []).map((t) => ({ id: t.id, isUsableOnce: true })) };
    }
    if (tapList && method === 'POST') {
      const uid = tapList[1] as string;
      if (this.failOn.tapPost) throw graphError(this.failOn.tapPost, 'Request_BadRequest');
      if ((this.taps.get(uid) ?? []).length > 0) {
        throw graphError(400, 'Request_BadRequest', 'A temporary access pass already exists for this user.');
      }
      const body = call.body as { isUsableOnce: boolean; lifetimeInMinutes: number };
      const id = `tap-${++this.tapSeq}`;
      this.taps.set(uid, [{ id }]);
      return {
        id,
        temporaryAccessPass: FAKE_TAP,
        isUsableOnce: body.isUsableOnce,
        lifetimeInMinutes: body.lifetimeInMinutes,
        startDateTime: '2026-11-03T08:00:00Z',
        createdDateTime: '2026-11-03T07:59:00Z',
        methodUsabilityReason: 'EnabledByPolicy',
      };
    }
    const tapOne = /^\/users\/([^/]+)\/authentication\/temporaryAccessPassMethods\/([^/]+)$/.exec(path);
    if (tapOne && method === 'DELETE') {
      this.taps.set(tapOne[1] as string, (this.taps.get(tapOne[1] as string) ?? []).filter((t) => t.id !== tapOne[2]));
      return undefined;
    }
    const check = /^\/users\/([^/]+)\/checkMemberGroups$/.exec(path);
    if (method === 'POST' && check) {
      const ids = (call.body as { groupIds: string[] }).groupIds;
      return { value: ids.filter((g) => this.groups.get(g)?.has(check[1] as string)) };
    }
    const children = /^\/sites\/[^/]+\/drives\/[^/]+\/root\/children$/.exec(path);
    if (method === 'POST' && children) {
      if (this.failOn.folder) throw graphError(this.failOn.folder, 'accessDenied');
      const name = (call.body as { name: string }).name;
      if (this.folders.has(name)) throw graphError(409, 'nameAlreadyExists', 'The specified item name already exists.');
      const item = { id: `folder-${this.folders.size + 1}`, folder: {} };
      this.folders.set(name, item);
      return { ...item, webUrl: `https://sp.test/${encodeURIComponent(name)}` };
    }
    const byName = /^\/sites\/[^/]+\/drives\/[^/]+\/root:\/(.+)$/.exec(path);
    if (method === 'GET' && byName) {
      const item = this.folders.get(decodeURIComponent(byName[1] as string));
      if (!item) throw graphError(404, 'itemNotFound');
      return { ...item, webUrl: 'https://sp.test/existing' };
    }
    if (method === 'POST' && path === '/users') {
      if (this.failOn.post) throw graphError(this.failOn.post, 'Authorization_RequestDenied');
      const body = call.body as { userPrincipalName: string; displayName: string; accountEnabled: boolean };
      if ([...this.users.values()].some((u) => u.upn === body.userPrincipalName)) {
        throw graphError(400, 'Request_BadRequest', 'Another object with the same value for property userPrincipalName already exists.');
      }
      const id = this.addUser(body.userPrincipalName, body.displayName, body.accountEnabled);
      this.users.get(id)!.props = { ...(call.body as object) };
      return { id };
    }
    const ref = /^\/users\/([^/]+)\/manager\/\$ref$/.exec(path);
    if (method === 'PUT' && ref) {
      if (this.putFailuresLeft > 0) {
        this.putFailuresLeft--;
        throw graphError(404, 'Request_ResourceNotFound');
      }
      if (this.failOn.put) throw graphError(this.failOn.put, 'Request_ResourceNotFound');
      this.users.get(ref[1] as string)!.manager = (call.body as Record<string, string>)['@odata.id'];
      return undefined;
    }
    if (method === 'PATCH' && one) {
      if (this.failOn.patch) throw graphError(this.failOn.patch, 'Request_BadRequest');
      const u = this.users.get(one[1] as string)!;
      const body = { ...(call.body as Record<string, unknown>) };
      if (Object.keys(body).some((k) => k.startsWith('extension_')) && this.failOn.statusPatch) {
        throw graphError(this.failOn.statusPatch, 'Request_BadRequest');
      }
      if ('accountEnabled' in body) {
        u.accountEnabled = body.accountEnabled as boolean;
        delete body.accountEnabled;
      }
      Object.assign(u.props, body);
      return undefined;
    }
    throw new Error(`Appel Graph non prévu : ${method} ${path}`);
  }
}
