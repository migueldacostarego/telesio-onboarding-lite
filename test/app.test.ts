import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertReady, loadConfig } from '../src/config';
import { normalizePart, upnBase } from '../src/upn';
import { EXT, RH_ID, principal, setup } from './helpers/ctx';

describe('API', () => {
  let ctx: ReturnType<typeof setup>;
  let server: Server;
  let base: string;
  let managerId: string;

  beforeAll(async () => {
    ctx = setup();
    managerId = ctx.graph.addUser('chef@exemple.test', 'Camille Responsable');
    server = ctx.app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const valid = () => ({ prenom: 'Éloïse', nom: 'De La Cruz', dateArrivee: '2026-11-03', poste: 'Comptable', service: 'Finance', managerId });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/demandes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ms-client-principal': principal(['RH']), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('healthz public ; les routes API exigent une identité', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/api/demandes/x/activer`, { method: 'POST' })).status).toBe(401);
  });

  describe('UPN', () => {
    it('est normalisé : minuscules, sans accents ni espaces', () => {
      expect(normalizePart('Éloïse')).toBe('eloise');
      expect(normalizePart("D'Artagnan Œuvre")).toBe('dartagnanoeuvre');
      expect(upnBase('Jean-Pierre', 'De La Cruz')).toBe('jean-pierre.delacruz');
    });
  });

  describe('POST /api/demandes', () => {
    it('crée le compte désactivé, manager, puis statut en dernier', async () => {
      ctx.graph.calls.length = 0;
      ctx.events.length = 0;
      const res = await post(valid());
      expect(res.status).toBe(201);
      const out = (await res.json()) as { id: string; userPrincipalName: string; statut: string };
      expect(out.userPrincipalName).toBe('eloise.delacruz@exemple.test');
      expect(out.statut).toBe('EnAttente');

      const created = ctx.graph.calls.find((c) => c.method === 'POST' && c.path === '/users')!.body as Record<string, unknown>;
      expect(created).toMatchObject({
        accountEnabled: false,
        employeeHireDate: '2026-11-03T00:00:00Z',
        jobTitle: 'Comptable',
        department: 'Finance',
        mailNickname: 'eloise.delacruz',
      });
      const pw = (created.passwordProfile as { password: string }).password;
      expect(pw).toHaveLength(32);

      const u = ctx.graph.users.get(out.id)!;
      expect(u.manager).toBe(`https://graph.microsoft.com/v1.0/users/${managerId}`);
      expect(u.props[EXT]).toBe('EnAttente');
      const writes = ctx.graph.calls.filter((c) => c.method !== 'GET').map((c) => c.method);
      expect(writes).toEqual(['POST', 'PUT', 'PATCH']);

      // Traces : qui/quoi, sans nom, UPN, mot de passe ni identité de l'embauché.
      expect(ctx.events.map((e) => e.action)).toEqual(['demande.compte_cree', 'demande.manager_affecte', 'demande.statut_pose']);
      expect(ctx.events.every((e) => e.actor === RH_ID)).toBe(true);
      const logged = JSON.stringify(ctx.events);
      for (const secret of [pw, 'eloise', 'Éloïse', 'cruz', 'exemple.test']) expect(logged.toLowerCase()).not.toContain(secret.toLowerCase());
    });

    it('ajoute un suffixe 2, 3… en cas de collision', async () => {
      ctx.graph.addUser('anna.martin@exemple.test');
      ctx.graph.addUser('anna.martin2@exemple.test');
      const res = await post({ ...valid(), prenom: 'Anna', nom: 'Martin' });
      expect(res.status).toBe(201);
      expect(((await res.json()) as { userPrincipalName: string }).userPrincipalName).toBe('anna.martin3@exemple.test');
    });

    it('réessaie si l’UPN est pris entre la vérification et la création', async () => {
      ctx.graph.addUser('luc.race@exemple.test');
      ctx.graph.hiddenOnce.add('luc.race@exemple.test');
      const res = await post({ ...valid(), prenom: 'Luc', nom: 'Race' });
      expect(res.status).toBe(201);
      expect(((await res.json()) as { userPrincipalName: string }).userPrincipalName).toBe('luc.race2@exemple.test');
    });

    it('réessaie le manager tant que le compte n’est pas répliqué', async () => {
      ctx.graph.putFailuresLeft = 2;
      const res = await post({ ...valid(), prenom: 'Rémi', nom: 'Retry' });
      expect(res.status).toBe(201);
    });

    it('502 sans statut si le manager ne peut pas être affecté', async () => {
      ctx.graph.failOn.put = 403;
      ctx.events.length = 0;
      const res = await post({ ...valid(), prenom: 'Paul', nom: 'Panne' });
      ctx.graph.failOn.put = undefined;
      expect(res.status).toBe(502);
      const body = (await res.json()) as { id: string; etape: string };
      expect(body.etape).toBe('manager_affectation');
      const u = ctx.graph.users.get(body.id)!;
      expect(u.accountEnabled).toBe(false);
      expect(u.props[EXT]).toBeUndefined();
      expect(ctx.events.at(-1)).toMatchObject({ action: 'demande.echec', etape: 'manager_affectation', cible: body.id });
    });

    it('400 : champs manquants', async () => {
      const res = await post({});
      expect(res.status).toBe(400);
      const out = (await res.json()) as { details: Record<string, string> };
      expect(Object.keys(out.details).sort()).toEqual(['dateArrivee', 'managerId', 'nom', 'poste', 'prenom', 'service']);
    });

    it.each([
      ['date inexistante', { dateArrivee: '2026-02-30' }, ['dateArrivee']],
      ['date passée', { dateArrivee: '2026-10-01' }, ['dateArrivee']],
      ['manager non GUID', { managerId: 'pas-un-guid' }, ['managerId']],
      ['nom sans lettre latine', { nom: '李' }, ['nom']],
      ['nom trop long', { nom: 'x'.repeat(65) }, ['nom']],
      ['type invalide', { poste: 42 }, ['poste']],
    ])('400 : %s', async (_label, patch, fields) => {
      const res = await post({ ...valid(), ...patch });
      expect(res.status).toBe(400);
      const out = (await res.json()) as { details: Record<string, string> };
      expect(Object.keys(out.details).sort()).toEqual([...fields].sort());
    });

    it('400 si le manager est introuvable', async () => {
      const res = await post({ ...valid(), managerId: '11111111-1111-4111-8111-111111111111' });
      expect(res.status).toBe(400);
    });

    it('400 propre sur JSON malformé, 415 hors JSON', async () => {
      expect((await post('{oups')).status).toBe(400);
      expect((await post('a=b', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    });

    it('refuse les corps compressés (415)', async () => {
      const res = await post(gzipSync(JSON.stringify(valid())) as unknown as string, { 'content-encoding': 'gzip' });
      expect(res.status).toBe(415);
    });

    it('401 sans identité, 403 sans rôle RH', async () => {
      const noAuth = await fetch(`${base}/api/demandes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(noAuth.status).toBe(401);
      expect((await post(valid(), { 'x-ms-client-principal': principal(['Autre']) })).status).toBe(403);
    });
  });

  describe('GET /api/annuaire', () => {
    it('cherche via $search sur displayName et mail', async () => {
      ctx.graph.calls.length = 0;
      const res = await fetch(`${base}/api/annuaire?q=${encodeURIComponent('Camille "x"')}`, {
        headers: { 'x-ms-client-principal': principal(['RH']) },
      });
      expect(res.status).toBe(200);
      const call = ctx.graph.calls[0]!;
      expect(call.search).toBe('"displayName:Camille x" OR "mail:Camille x"');
      expect(call.headers.ConsistencyLevel).toBe('eventual');
    });

    it('400 si q est trop court', async () => {
      const res = await fetch(`${base}/api/annuaire?q=a`, { headers: { 'x-ms-client-principal': principal(['RH']) } });
      expect(res.status).toBe(400);
    });
  });

  it('fail closed si Easy Auth n’est pas actif', async () => {
    const off = setup({}, { trustAuthHeaders: false });
    const s = off.app.listen(0);
    await new Promise((r) => s.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/annuaire?q=ab`, {
        headers: { 'x-ms-client-principal': principal(['RH']) },
      });
      expect(res.status).toBe(503);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});

describe('config', () => {
  it('laisse direction et SharePoint non tranchés, exige domaine et extension', () => {
    const c = loadConfig({});
    expect(c.direction.objectId).toBeUndefined();
    expect(c.sharePoint.siteId).toBeUndefined();
    expect(() => assertReady(c)).toThrow(/UPN_DOMAIN, ENTRA_STATUS_EXTENSION/);
    expect(() => loadConfig({ ENTRA_STATUS_EXTENSION: 'statutOnboarding' })).toThrow();
  });

  it('ignore le contournement d’auth de dev en production', () => {
    expect(loadConfig({ ALLOW_INSECURE_DEV_AUTH: 'true' }).trustAuthHeaders).toBe(true);
    expect(loadConfig({ ALLOW_INSECURE_DEV_AUTH: 'true', NODE_ENV: 'production' }).trustAuthHeaders).toBe(false);
  });
});
