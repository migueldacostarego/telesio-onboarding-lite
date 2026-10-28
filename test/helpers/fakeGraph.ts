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
  expand?: string;
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
    groupAdd?: number;
    groupRemove?: number;
    /** Échec de GET /subscribedSkus. */
    skus?: number;
  } = {};
  /** TAP existants par utilisateur : un seul autorisé, comme dans Entra. */
  taps = new Map<string, { id: string }[]>();
  private tapSeq = 0;
  /** groupId -> membres */
  groups = new Map<string, Set<string>>();
  /** Dossiers SharePoint : nom -> { id, folder? } (folder absent = c'est un fichier). */
  folders = new Map<string, { id: string; folder?: object }>();
  deleted: string[] = [];
  /** SKU -> unités (GET /subscribedSkus : prepaidUnits.enabled et consumedUnits). */
  skus = new Map<string, { enabled: number; consumed: number }>();
  /** Groupes de licence par groupe : groupId -> skuId. */
  licenseGroups = new Map<string, string>();
  /** Résultat du traitement par groupe : ok (Active) ou erreur d'attribution (state Error, error = ce code). */
  licenseOutcome: 'ok' | string = 'ok';
  /** Lectures de l'utilisateur sans entrée de licence après l'ajout au groupe (traitement asynchrone). */
  licensePendingReads = 0;
  /** Entrée de licence dans un état autre qu'Active (error « None », comme Graph) : ex. 'Disabled'. */
  licenseForcedState?: string;
  private licenses = new Map<string, { group: string; sku: string; reads: number; counted: boolean }>();
  /** Nombre d'échecs PUT restants avant succès (réplication). */
  putFailuresLeft = 0;
  /** UPN existant mais invisible au 1er contrôle de disponibilité (course entre contrôle et création). */
  hiddenOnce = new Set<string>();
  /** Taille de page des listes d'utilisateurs filtrées par statut (0 : tout d'un coup), avec @odata.nextLink. */
  pageSize = 0;
  private seq = 0;

  addUser(upn: string, displayName = 'Compte Test', accountEnabled = true): string {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.users.set(id, { id, upn, accountEnabled, displayName, mail: upn, props: {} });
    return id;
  }

  /** Compte d'onboarding tel que créé par POST /api/demandes. */
  addPending(ext: string, p: { givenName: string; surname: string; statut?: string; managerId?: string; hireDate?: string; enabled?: boolean; extras?: Record<string, unknown> }): string {
    const id = this.addUser(`${p.givenName}.${p.surname}@exemple.test`.toLowerCase(), `${p.givenName} ${p.surname}`, p.enabled ?? false);
    const u = this.users.get(id)!;
    u.props = {
      givenName: p.givenName,
      surname: p.surname,
      jobTitle: 'Comptable',
      department: 'Finance',
      employeeHireDate: `${p.hireDate ?? '2026-11-03'}T00:00:00Z`,
      [ext]: p.statut ?? 'EnAttente',
      ...p.extras,
    };
    if (p.managerId) u.manager = `https://graph.microsoft.com/v1.0/users/${p.managerId}`;
    return id;
  }

  /** Compte déjà licencié par le groupe (reprise) : membre, entrée Active, unité déjà comptée par le test. */
  addLicensed(userId: string, group: string, sku: string) {
    this.groups.set(group, (this.groups.get(group) ?? new Set()).add(userId));
    this.licenses.set(userId, { group, sku, reads: Number.MAX_SAFE_INTEGER, counted: true });
  }

  private licenseStates(userId: string) {
    if (!this.licenses.has(userId)) {
      // Membre posé directement dans `groups` : Entra le traite comme un membre ajouté par l'API.
      for (const [group, sku] of this.licenseGroups) {
        if (this.groups.get(group)?.has(userId)) this.licenses.set(userId, { group, sku, reads: 0, counted: false });
      }
    }
    const l = this.licenses.get(userId);
    if (!l || !this.groups.get(l.group)?.has(userId)) return [];
    if (l.reads < this.licensePendingReads) {
      l.reads++;
      return [];
    }
    if (this.licenseForcedState) {
      return [{ skuId: l.sku, assignedByGroup: l.group, state: this.licenseForcedState, error: 'None' }];
    }
    if (this.licenseOutcome !== 'ok') {
      return [{ skuId: l.sku, assignedByGroup: l.group, state: 'Error', error: this.licenseOutcome }];
    }
    if (!l.counted) {
      l.counted = true;
      const sku = this.skus.get(l.sku);
      if (sku) sku.consumed++;
    }
    return [{ skuId: l.sku, assignedByGroup: l.group, state: 'Active', error: 'None' }];
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
      expand: (e: string) => ((call.expand = e), req),
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

  private handle(input: Call): unknown {
    // Un nextLink est une URL absolue : on en extrait chemin, filtre, expand et position.
    let skip = 0;
    let call = input;
    if (call.path.startsWith('https://graph.microsoft.com/v1.0')) {
      const u = new URL(call.path);
      skip = Number(u.searchParams.get('$skiptoken') ?? 0);
      call = {
        ...call,
        path: u.pathname.replace('/v1.0', ''),
        filter: u.searchParams.get('$filter') ?? undefined,
        expand: u.searchParams.get('$expand') ?? undefined,
      };
    }
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
        // Comportement mesuré sur le vrai Graph : statut + employeeHireDate + $expand => 400.
        if (since && call.expand) throw graphError(400, 'Request_UnsupportedQuery', 'Unsupported or invalid query filter clause specified');
        const all = [...this.users.values()]
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
        if (!this.pageSize) return { value: all };
        const value = all.slice(skip, skip + this.pageSize);
        if (skip + this.pageSize >= all.length) return { value };
        const q = [`$filter=${encodeURIComponent(call.filter ?? '')}`, call.expand ? `$expand=${encodeURIComponent(call.expand)}` : '', `$skiptoken=${skip + this.pageSize}`];
        return { value, '@odata.nextLink': `https://graph.microsoft.com/v1.0/users?${q.filter(Boolean).join('&')}` };
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
        licenseAssignmentStates: this.licenseStates(u.id),
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
    if (method === 'GET' && path === '/subscribedSkus') {
      if (this.failOn.skus) throw graphError(this.failOn.skus, 'Authorization_RequestDenied');
      return {
        value: [...this.skus].map(([skuId, u]) => ({ skuId, consumedUnits: u.consumed, prepaidUnits: { enabled: u.enabled } })),
      };
    }
    const add = /^\/groups\/([^/]+)\/members\/\$ref$/.exec(path);
    if (method === 'POST' && add) {
      if (this.failOn.groupAdd) throw graphError(this.failOn.groupAdd, 'Authorization_RequestDenied');
      const g = add[1] as string;
      const uid = (call.body as Record<string, string>)['@odata.id']!.split('/').pop() as string;
      const members = this.groups.get(g) ?? new Set<string>();
      if (members.has(uid)) {
        throw graphError(400, 'Request_BadRequest', "One or more added object references already exist for the following modified properties: 'members'.");
      }
      this.groups.set(g, members.add(uid));
      const sku = this.licenseGroups.get(g);
      if (sku && !this.licenses.has(uid)) this.licenses.set(uid, { group: g, sku, reads: 0, counted: false });
      return undefined;
    }
    const drop = /^\/groups\/([^/]+)\/members\/([^/]+)\/\$ref$/.exec(path);
    if (method === 'DELETE' && drop) {
      if (this.failOn.groupRemove) throw graphError(this.failOn.groupRemove, 'Authorization_RequestDenied');
      if (!this.groups.get(drop[1] as string)?.delete(drop[2] as string)) throw graphError(404, 'Request_ResourceNotFound');
      this.licenses.delete(drop[2] as string);
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
