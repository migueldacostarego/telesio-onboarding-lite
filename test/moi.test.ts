import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RH_ID, principal } from './helpers/ctx';
import { loadConfig } from '../src/config';
import { harness } from './helpers/harness';

const NAME = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name';
const AUCUN = { acces: false, creer: false, approuver: false, activer: false };
const MAIL = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';

describe('GET /api/moi', () => {
  const h = harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());
  const moi = (header?: string) => fetch(`${h.base}/api/moi`, { headers: header ? { 'x-ms-client-principal': header } : {} });
  const as = (roles: string[], extra: { typ: string; val: string }[] = []) => moi(principal(roles, RH_ID, extra));

  it('renvoie le nom, l’email et les rôles de l’identité Easy Auth, sans aucun appel Graph', async () => {
    const res = await as(['RH'], [{ typ: 'name', val: 'Camille Exemple' }, { typ: 'email', val: 'camille@exemple.test' }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      nom: 'Camille Exemple',
      email: 'camille@exemple.test',
      roles: ['RH'],
      droits: { acces: true, creer: true, approuver: false, activer: true },
      domaine: 'exemple.test',
    });
    expect(h.ctx.graph.calls).toEqual([]);
  });

  it('jamais mise en cache, erreurs comprises', async () => {
    for (const res of [await as(['RH']), await moi()]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('pragma')).toBe('no-cache');
    }
  });

  it('lit aussi les types de revendication longs et dédoublonne les rôles', async () => {
    const res = await as(['Direction', 'RH', 'RH'], [{ typ: NAME, val: 'Camille Exemple' }, { typ: MAIL, val: 'camille@exemple.test' }]);
    expect(await res.json()).toMatchObject({ nom: 'Camille Exemple', email: 'camille@exemple.test', roles: ['Direction', 'RH'] });
  });

  it('sans revendication email, le nom d’utilisateur sert d’email ; l’email prime sur lui quand il existe', async () => {
    const seul = await as(['RH'], [{ typ: 'name', val: 'Camille Exemple' }, { typ: 'preferred_username', val: 'camille@exemple.test' }]);
    expect(await seul.json()).toMatchObject({ email: 'camille@exemple.test' });
    const deux = await as(['RH'], [{ typ: 'preferred_username', val: 'upn@exemple.test' }, { typ: 'email', val: 'mail@exemple.test' }]);
    expect(await deux.json()).toMatchObject({ email: 'mail@exemple.test' });
  });

  it('sans nom dans le jeton, le nom retombe sur l’email ; sans rien, chaîne vide et email null', async () => {
    const mail = await as([], [{ typ: 'email', val: 'camille@exemple.test' }]);
    expect(await mail.json()).toEqual({ nom: 'camille@exemple.test', email: 'camille@exemple.test', roles: [], droits: AUCUN, domaine: 'exemple.test' });
    const rien = await as([]);
    expect(await rien.json()).toEqual({ nom: '', email: null, roles: [], droits: AUCUN, domaine: 'exemple.test' });
  });

  it('une personne connectée sans rôle reçoit 200 (c’est à l’interface de lui refuser l’accès)', async () => {
    expect((await as([])).status).toBe(200);
  });

  it('ne renvoie que nom, email et rôles : ni objectId, ni autre revendication', async () => {
    const res = await as(['RH'], [{ typ: 'name', val: 'Camille Exemple' }, { typ: 'tid', val: 'tenant-secret' }, { typ: 'preferred_username', val: 'camille@exemple.test' }]);
    const body = await res.text();
    expect(Object.keys(JSON.parse(body) as object).sort()).toEqual(['domaine', 'droits', 'email', 'nom', 'roles']);
    expect(body).not.toContain(RH_ID);
    expect(body).not.toContain('tenant-secret');
  });

  it('borne la longueur des valeurs lues dans le jeton', async () => {
    const res = await as([], [{ typ: 'name', val: 'x'.repeat(5000) }]);
    expect(((await res.json()) as { nom: string }).nom).toHaveLength(256);
  });

  it('401 sans identité ou avec un en-tête illisible, sans rien tracer d’autre qu’un refus', async () => {
    expect((await moi()).status).toBe(401);
    expect((await moi('pas-du-base64')).status).toBe(401);
    expect((await moi(Buffer.from('{}').toString('base64'))).status).toBe(401);
    expect(h.ctx.events.every((e) => e.action === 'acces.refuse' && e.reason === 'non_authentifie')).toBe(true);
  });
});

describe('GET /api/moi : droits calculés côté serveur', () => {
  const h = harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());
  const droits = async (roles: string[]) =>
    ((await (await fetch(`${h.base}/api/moi`, { headers: { 'x-ms-client-principal': principal(roles) } })).json()) as { droits: object }).droits;

  it('RH : créer et activer, pas approuver', async () => {
    expect(await droits(['RH'])).toEqual({ acces: true, creer: true, approuver: false, activer: true });
  });

  it('Direction : tous les droits de RH (créer, activer) plus approuver', async () => {
    expect(await droits(['Direction'])).toEqual({ acces: true, creer: true, approuver: true, activer: true });
  });

  it('RH et Direction ensemble : les mêmes droits que Direction seule', async () => {
    expect(await droits(['RH', 'Direction'])).toEqual({ acces: true, creer: true, approuver: true, activer: true });
  });

  it('aucun rôle connu : aucun droit, accès compris (un rôle étranger ne donne rien)', async () => {
    expect(await droits([])).toEqual(AUCUN);
    expect(await droits(['Autre', 'rh', 'DIRECTION'])).toEqual(AUCUN);
  });

  it('les droits ne dépendent que des rôles du jeton : une identité sans rôle n’a aucun droit', async () => {
    const res = await fetch(`${h.base}/api/moi`, { headers: { 'x-ms-client-principal': principal([], 'bbbbbbbb-0000-4000-8000-000000000002') } });
    expect(((await res.json()) as { droits: object }).droits).toEqual(AUCUN);
  });

  it('acces vaut « au moins un droit »', async () => {
    for (const roles of [[], ['RH'], ['Direction'], ['RH', 'Direction']]) {
      const d = (await droits(roles)) as Record<string, boolean>;
      expect(d.acces).toBe(d.creer || d.approuver || d.activer);
    }
  });
});

describe('GET /api/moi : noms de rôle configurables (RH_ROLE, DIRECTION_ROLE)', () => {
  const h = harness({ RH_ROLE: 'RessourcesHumaines', DIRECTION_ROLE: 'Dirigeants' });
  beforeAll(() => h.start());
  afterAll(() => h.stop());
  const moi = async (roles: string[]) =>
    (await (await fetch(`${h.base}/api/moi`, { headers: { 'x-ms-client-principal': principal(roles) } })).json()) as { roles: string[]; droits: object };

  it('les droits suivent les noms configurés ; les noms par défaut ne comptent plus', async () => {
    expect((await moi(['RessourcesHumaines'])).droits).toEqual({ acces: true, creer: true, approuver: false, activer: true });
    expect((await moi(['Dirigeants'])).droits).toEqual({ acces: true, creer: true, approuver: true, activer: true });
    expect((await moi(['RH', 'Direction'])).droits).toEqual(AUCUN);
  });

  it('roles reste la liste brute des rôles du jeton (le badge de l’interface affiche ces noms)', async () => {
    expect((await moi(['Dirigeants', 'RessourcesHumaines'])).roles).toEqual(['Dirigeants', 'RessourcesHumaines']);
  });
});

describe('DIRECTION_ROLE', () => {
  it('vaut « Direction » par défaut et s’aligne sur direction_role de Terraform', () => {
    expect(loadConfig({}).directionRole).toBe('Direction');
    expect(loadConfig({ DIRECTION_ROLE: ' Dirigeants ' }).directionRole).toBe('Dirigeants');
    expect(loadConfig({ DIRECTION_ROLE: '   ' }).directionRole).toBe('Direction');
  });
});

describe('GET /api/moi sans Easy Auth', () => {
  const h = harness({}, { trustAuthHeaders: false });
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('503 : l’en-tête serait falsifiable', async () => {
    const res = await fetch(`${h.base}/api/moi`, { headers: { 'x-ms-client-principal': principal(['RH']) } });
    expect(res.status).toBe(503);
  });
});
