import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../src/dates';
import { loadConfig } from '../src/config';
import { DIR_ID, EXT } from './helpers/ctx';
import { FAKE_TAP } from './helpers/fakeGraph';
import { harness } from './helpers/harness';

// NOW (ctx) = 2026-10-27 10:00 UTC, soit le 27 octobre à Paris.
const TODAY = '2026-10-27';

describe('POST /api/demandes/:id/activer', () => {
  const h = harness();
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());

  const account = (statut = 'Validé', hireDate = TODAY, enabled = false) =>
    h.ctx.graph.addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut, hireDate, enabled });
  const activer = (id: string) => h.callRh('POST', `/api/demandes/${id}/activer`);
  const writes = () => h.ctx.graph.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.replace(/^\/users\/[^/]+/, '')}`);

  it('active le compte, crée un TAP à usage unique, puis pose Actif', async () => {
    const id = account();
    const res = await activer(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');

    const out = (await res.json()) as Record<string, unknown>;
    expect(out).toEqual({
      id,
      statut: 'Actif',
      regeneration: false,
      temporaryAccessPass: FAKE_TAP,
      lifetimeInMinutes: 480,
      startDateTime: '2026-11-03T08:00:00Z',
      isUsableOnce: true,
    });

    const u = h.ctx.graph.users.get(id)!;
    expect(u.accountEnabled).toBe(true);
    expect(u.props[EXT]).toBe('Actif');
    expect(writes()).toEqual(['PATCH ', 'POST /authentication/temporaryAccessPassMethods', 'PATCH ']);
    const post = h.ctx.graph.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ isUsableOnce: true, lifetimeInMinutes: 480 });
  });

  it('ne trace jamais le TAP (ni nom, ni UPN)', async () => {
    const id = account();
    await activer(id);
    const logged = JSON.stringify(h.ctx.events);
    expect(logged).not.toContain(FAKE_TAP);
    expect(logged).not.toContain('Martin');
    expect(logged).not.toContain('exemple.test');
    expect(h.ctx.events.map((e) => e.action)).toEqual(['demande.compte_active', 'demande.tap_cree', 'demande.activee']);
    expect(h.ctx.events.at(-2)).toMatchObject({ cible: id, dureeMinutes: 480, actor: expect.any(String) });
  });

  it('409 avant la date d’arrivée : rien n’est écrit, en-têtes no-store présents', async () => {
    const id = account('Validé', '2026-10-28');
    const res = await activer(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Activation impossible', raison: 'date_arrivee_future' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(writes()).toEqual([]);
    expect(h.ctx.graph.users.get(id)!.accountEnabled).toBe(false);
  });

  it('accepte une date d’arrivée passée', async () => {
    expect((await activer(account('Validé', '2026-10-01'))).status).toBe(200);
  });

  it('409 si le statut n’est pas Validé (EnAttente, Refusé, hors onboarding)', async () => {
    for (const statut of ['EnAttente', 'Refusé']) expect((await activer(account(statut))).status).toBe(409);
    const autre = h.ctx.graph.addUser('autre@exemple.test', 'Autre');
    expect((await activer(autre)).status).toBe(409);
    expect(writes()).toEqual([]);
  });

  it('401 sans identité, 403 sans rôle RH (le valideur seul ne peut pas activer)', async () => {
    const id = account();
    expect((await fetch(`${h.base}/api/demandes/${id}/activer`, { method: 'POST' })).status).toBe(401);
    expect((await h.call('POST', `/api/demandes/${id}/activer`, DIR_ID)).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it('Régénérer : supprime le TAP existant puis en recrée un', async () => {
    const id = account('Validé', TODAY, false);
    await activer(id);
    h.ctx.graph.calls.length = 0;
    h.ctx.events.length = 0;

    const res = await activer(id); // compte Actif : « Régénérer »
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ statut: 'Actif', regeneration: true, temporaryAccessPass: FAKE_TAP });
    expect(writes()).toEqual([
      'DELETE /authentication/temporaryAccessPassMethods/tap-1',
      'POST /authentication/temporaryAccessPassMethods',
    ]);
    expect(h.ctx.graph.taps.get(id)).toEqual([{ id: 'tap-2' }]);
    expect(h.ctx.events.map((e) => e.action)).toEqual(['demande.tap_supprime', 'demande.tap_cree']);
    expect(JSON.stringify(h.ctx.events)).not.toContain(FAKE_TAP);
  });

  it('Régénérer : 409 une fois la fenêtre dépassée', async () => {
    const dansLaFenetre = account('Actif', addDays(TODAY, -7), true);
    const hors = account('Actif', addDays(TODAY, -8), true);
    expect((await activer(dansLaFenetre)).status).toBe(200);
    const res = await activer(hors);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ raison: 'fenetre_regeneration_depassee' });
  });

  it('échec du TAP : 502 avec l’étape, compte activé mais resté Validé, reprise possible', async () => {
    const id = account();
    h.ctx.graph.failOn.tapPost = 500;
    const res = await activer(id);
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'tap_creation', statut: 'Validé' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.ctx.graph.users.get(id)!.accountEnabled).toBe(true);
    expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Validé');

    h.ctx.graph.failOn.tapPost = undefined;
    const retry = await activer(id);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ statut: 'Actif', temporaryAccessPass: FAKE_TAP });
  });

  it('échec du statut après le TAP : 502 sans TAP dans la réponse, la reprise le recrée', async () => {
    const id = account();
    h.ctx.graph.failOn.statusPatch = 500;
    const res = await activer(id);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(FAKE_TAP);
    expect(JSON.parse(text)).toMatchObject({ etape: 'statut' });
    expect(JSON.stringify(h.ctx.events)).not.toContain(FAKE_TAP);

    h.ctx.graph.failOn.statusPatch = undefined;
    h.ctx.graph.calls.length = 0;
    const retry = await activer(id);
    expect(retry.status).toBe(200);
    expect(writes()).toContain('DELETE /authentication/temporaryAccessPassMethods/tap-1');
    expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Actif');
  });
});

describe('GET /api/activations', () => {
  const h = harness();
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());

  it('liste les Validé (activer ou attendre) et les Actif récents, réservé RH', async () => {
    const g = h.ctx.graph;
    g.addPending(EXT, { givenName: 'Jour', surname: 'J', statut: 'Validé', hireDate: TODAY });
    g.addPending(EXT, { givenName: 'Plus', surname: 'Tard', statut: 'Validé', hireDate: '2026-11-15' });
    g.addPending(EXT, { givenName: 'Recent', surname: 'Actif', statut: 'Actif', hireDate: '2026-10-25', enabled: true });
    g.addPending(EXT, { givenName: 'Ancien', surname: 'Actif', statut: 'Actif', hireDate: '2026-06-01', enabled: true });
    g.addPending(EXT, { givenName: 'En', surname: 'Attente', statut: 'EnAttente' });

    const res = await h.callRh('GET', '/api/activations');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const out = (await res.json()) as { demandes: { nom: string; action: string; statut: string }[] };
    expect(out.demandes.map((d) => [d.nom, d.statut, d.action])).toEqual([
      ['Jour J', 'Validé', 'activer'],
      ['Plus Tard', 'Validé', 'attendre'],
      ['Recent Actif', 'Actif', 'regenerer'],
    ]);
    expect((await h.call('GET', '/api/activations', DIR_ID)).status).toBe(403);
  });
});

describe('pages HTML', () => {
  const h = harness();
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());

  it.each(['/demande', '/direction', '/activation'])('%s : CSP à nonce, no-store, pas de innerHTML', async (path) => {
    const res = await fetch(`${h.base}${path}`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(csp).toContain("default-src 'none'");
    expect(html).not.toMatch(/innerHTML|localStorage|sessionStorage/);
    expect(html).not.toMatch(/[—]/); // pas de tiret cadratin dans l'interface
  });
});

describe('fuseau et config', () => {
  it('le jour J se calcule dans le fuseau métier, pas en UTC', () => {
    const lateUtc = new Date('2026-10-26T23:30:00Z'); // 00:30 le 27 à Paris
    expect(todayIn('Europe/Paris', lateUtc)).toBe('2026-10-27');
    expect(todayIn('UTC', lateUtc)).toBe('2026-10-26');
  });

  it('valide TAP_LIFETIME_MINUTES et TZ_METIER, défauts 480 min et Europe/Paris', () => {
    const c = loadConfig({});
    expect([c.tapLifetimeMinutes, c.timeZone]).toEqual([480, 'Europe/Paris']);
    for (const v of ['9', '43201', '1.5', 'abc']) expect(() => loadConfig({ TAP_LIFETIME_MINUTES: v })).toThrow();
    expect(loadConfig({ TAP_LIFETIME_MINUTES: '60' }).tapLifetimeMinutes).toBe(60);
    expect(() => loadConfig({ TZ_METIER: 'Mars/Olympus' })).toThrow();
  });
});
