import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ARRIVANTS_GROUP, DIR_ID, EXT, EXT_ACT, RH_ID } from './helpers/ctx';
import { harness } from './helpers/harness';

// NOW (ctx) = 2026-10-27 10:00 UTC. Fenêtre des Terminé : activation après le 2026-09-27 10:00 UTC.
const IL_Y_A_29_JOURS = '2026-09-28T10:00:00Z';
const IL_Y_A_31_JOURS = '2026-09-26T10:00:00Z';

type Item = { id: string; nom: string; upn: string | null; poste: string | null; service: string | null; dateArrivee: string | null; statut: string; etape: number; onboarding?: unknown };
type Suivi = { demandes: Item[]; tronque: boolean };

function suite(env: Record<string, string | undefined> = {}) {
  const h = harness(env);
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());
  const g = () => h.ctx.graph;
  const compte = (prenom: string, statut: string, o: { hireDate?: string; extras?: Record<string, unknown>; authenticator?: boolean } = {}) => {
    const id = g().addPending(EXT, {
      givenName: prenom,
      surname: 'Test',
      statut,
      hireDate: o.hireDate ?? '2026-10-20',
      enabled: statut === 'Actif' || statut === 'Terminé',
      extras: o.extras,
    });
    if (statut === 'Actif') g().groups.set(ARRIVANTS_GROUP, (g().groups.get(ARRIVANTS_GROUP) ?? new Set()).add(id));
    if (o.authenticator) g().authenticators.add(id);
    return id;
  };
  const termine = (prenom: string, activation: string | undefined, hireDate = '2026-09-20') =>
    compte(prenom, 'Terminé', { hireDate, extras: activation ? { [EXT_ACT]: activation } : undefined });
  const suivi = async () => (await (await h.callRh('GET', '/api/suivi')).json()) as Suivi;
  const nbLecturesDe = (id: string) => g().calls.filter((c) => c.method === 'GET' && c.path === `/users/${id}`).length;
  return { h, g, compte, termine, suivi, nbLecturesDe };
}

describe('GET /api/suivi', () => {
  const { h, g, compte, termine, suivi, nbLecturesDe } = suite();

  it('liste les quatre statuts avec leur étape, réservée aux porteurs d’un rôle (RH ou Direction)', async () => {
    compte('Attente', 'EnAttente');
    compte('Valide', 'Validé');
    compte('Actif', 'Actif', { extras: { [EXT_ACT]: '2026-10-26T10:00:00Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' }, authenticator: true });
    termine('Fini', IL_Y_A_29_JOURS);
    compte('Refuse', 'Refusé');

    const res = await h.callRh('GET', '/api/suivi');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const out = (await res.json()) as Suivi;
    expect(out.tronque).toBe(false);
    expect(out.demandes.map((d) => [d.nom, d.statut, d.etape])).toEqual([
      ['Attente Test', 'EnAttente', 1],
      ['Valide Test', 'Validé', 2],
      ['Actif Test', 'Actif', 3],
      ['Fini Test', 'Terminé', 4],
    ]);
    expect((await h.call('GET', '/api/suivi', DIR_ID)).status).toBe(200);
    expect((await h.callAs([], DIR_ID, 'GET', '/api/suivi')).status).toBe(403);
    expect((await h.callAs(['Autre'], DIR_ID, 'GET', '/api/suivi')).status).toBe(403);
    expect((await fetch(`${h.base}/api/suivi`)).status).toBe(401);
  });

  it('chaque demande ne porte que id, nom, upn, poste, service, date d’arrivée, statut, étape, actions (et onboarding pour Actif)', async () => {
    const manager = g().addUser('chef@exemple.test', 'Chef Secret');
    const id = g().addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut: 'Validé', hireDate: '2026-10-27', managerId: manager });
    const out = await suivi();
    expect(out.demandes).toEqual([
      { id, nom: 'Anna Martin', upn: 'anna.martin@exemple.test', poste: 'Comptable', service: 'Finance', dateArrivee: '2026-10-27', statut: 'Validé', etape: 2, actions: ['activer'] },
    ]);
    expect(JSON.stringify(out)).not.toContain('Chef Secret');
  });

  it('l’adresse professionnelle (UPN) est renvoyée pour chaque statut, lue avec le reste dans la même requête Graph', async () => {
    compte('Attente', 'EnAttente');
    compte('Valide', 'Validé');
    compte('Actif', 'Actif');
    termine('Fini', IL_Y_A_29_JOURS);
    const out = await suivi();
    expect(out.demandes.map((d) => [d.statut, d.upn])).toEqual([
      ['EnAttente', 'attente.test@exemple.test'],
      ['Validé', 'valide.test@exemple.test'],
      ['Actif', 'actif.test@exemple.test'],
      ['Terminé', 'fini.test@exemple.test'],
    ]);
    // Une requête par statut, aucune lecture de plus par compte pour l'adresse.
    expect(g().calls.filter((c) => c.method === 'GET' && c.path === '/users' && c.select?.includes('userPrincipalName'))).toHaveLength(4);
  });

  it('Actif : onboarding calculé comme GET /activations, un échec de lecture est limité au compte concerné', async () => {
    compte('Complet', 'Actif', { extras: { [EXT_ACT]: '2026-10-26T10:00:00Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' }, authenticator: true });
    compte('Partiel', 'Actif', { extras: { [EXT_ACT]: '2026-10-26T10:00:00Z', lastPasswordChangeDateTime: '2026-10-26T10:00:05Z' } });
    const out = await suivi();
    expect(out.demandes.map((d) => [d.nom, d.onboarding])).toEqual([
      ['Complet Test', { motDePasse: true, authenticator: true, termine: true }],
      ['Partiel Test', { motDePasse: false, authenticator: false, termine: false }],
    ]);
    const activations = (await (await h.callRh('GET', '/api/activations')).json()) as { demandes: { nom: string; onboarding: unknown }[] };
    expect(activations.demandes.map((d) => [d.nom, d.onboarding])).toEqual(out.demandes.map((d) => [d.nom, d.onboarding]));

    g().failOn.authenticator = 403;
    const degrade = await suivi();
    expect(degrade.demandes.map((d) => d.onboarding)).toEqual([{ verification: 'echec' }, { verification: 'echec' }]);
    expect(degrade.demandes.map((d) => d.statut)).toEqual(['Actif', 'Actif']);
  });

  describe('Terminé : activation de moins de 30 jours', () => {
    it('garde les activations récentes, écarte les anciennes, trie de la plus récente à la plus ancienne', async () => {
      termine('Ancien', IL_Y_A_31_JOURS);
      termine('Recent', '2026-10-25T10:00:00Z');
      termine('Limite', IL_Y_A_29_JOURS);
      const out = await suivi();
      expect(out.demandes.map((d) => d.nom)).toEqual(['Recent Test', 'Limite Test']);
      expect(out.demandes.every((d) => d.statut === 'Terminé' && d.etape === 4 && d.onboarding === undefined)).toBe(true);
    });

    it('un compte arrivé il y a longtemps mais activé récemment est listé (activation tardive)', async () => {
      termine('Tardif', '2026-10-24T10:00:00Z', '2026-09-01');
      expect((await suivi()).demandes.map((d) => d.nom)).toEqual(['Tardif Test']);
    });

    it('une arrivée trop ancienne (plus de 90 jours) n’est pas lue dans Graph et n’est pas listée', async () => {
      const vieux = termine('Vieux', '2026-10-25T10:00:00Z', '2026-06-01');
      expect((await suivi()).demandes).toEqual([]);
      expect(nbLecturesDe(vieux)).toBe(0);
    });

    it('compte activé avant l’extension d’activation : repli sur la création du compte', async () => {
      compte('SansExt', 'Terminé', { extras: { createdDateTime: '2026-10-10T10:00:00Z' } });
      compte('SansExtAncien', 'Terminé', { extras: { createdDateTime: '2026-08-10T10:00:00Z' } });
      expect((await suivi()).demandes.map((d) => d.nom)).toEqual(['SansExt Test']);
    });

    it('lecture impossible : le compte reste listé (date inconnue) et l’échec est tracé, sans faire échouer la liste', async () => {
      const id = termine('Inconnu', IL_Y_A_31_JOURS);
      g().failOn.read = 403;
      const res = await h.callRh('GET', '/api/suivi');
      expect(res.status).toBe(200);
      expect(((await res.json()) as Suivi).demandes.map((d) => d.nom)).toEqual(['Inconnu Test']);
      expect(h.ctx.events.find((e) => e.action === 'demande.echec')).toMatchObject({ etape: 'suivi_activation', cible: id, http: 403 });
    });
  });

  it('au plus 100 comptes par statut, tronque l’indique ; les autres statuts ne sont pas affectés', async () => {
    for (let i = 0; i < 101; i++) compte(`V${i}`, 'Validé');
    for (let i = 0; i < 101; i++) termine(`T${i}`, '2026-10-25T10:00:00Z');
    compte('Seul', 'EnAttente');
    const out = await suivi();
    expect(out.tronque).toBe(true);
    const par = (s: string) => out.demandes.filter((d) => d.statut === s).length;
    expect([par('EnAttente'), par('Validé'), par('Actif'), par('Terminé')]).toEqual([1, 100, 0, 100]);
  });

  it('tronque reste faux sous le plafond, et vrai si Graph tronque lui-même la liste (pages)', async () => {
    g().pageSize = 1;
    for (let i = 0; i < 12; i++) compte(`V${i}`, 'Validé');
    const out = await suivi();
    expect(out.tronque).toBe(true);
    expect(out.demandes).toHaveLength(10);
  });

  it('ne filtre côté Graph que sur le statut (statut + date + $expand est refusé par Graph)', async () => {
    termine('Recent', '2026-10-25T10:00:00Z');
    await suivi();
    const lists = g().calls.filter((c) => c.method === 'GET' && c.path === '/users');
    expect(lists).toHaveLength(4);
    for (const c of lists) expect(c.filter).toMatch(/^extension_\w+ eq '[^']+'$/);
  });

  it('lecture seule, sans permission nouvelle : aucune écriture, événement suivi.liste avec l’objectId seulement', async () => {
    compte('Attente', 'EnAttente');
    compte('Actif', 'Actif', { extras: { [EXT_ACT]: '2026-10-26T10:00:00Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' } });
    termine('Fini', IL_Y_A_29_JOURS);
    await suivi();
    expect(g().calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(h.ctx.events).toEqual([{ action: 'suivi.liste', actor: RH_ID, outcome: 'ok', resultats: 3, tronque: false }]);
    const logged = JSON.stringify(h.ctx.events);
    expect(logged).not.toContain('Test');
    expect(logged).not.toContain('exemple.test');
  });

  it('échec de la liste Graph : 502 avec l’étape, sans message brut', async () => {
    g().failOn.list = 403;
    const res = await h.callRh('GET', '/api/suivi');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'liste' });
    expect(h.ctx.events.find((e) => e.action === 'demande.echec')).toMatchObject({ etape: 'liste', http: 403 });
  });
});

describe('GET /api/suivi : activation non configurée', () => {
  for (const [nom, env] of [
    ['ARRIVANTS_GROUP_ID', { ARRIVANTS_GROUP_ID: undefined }],
    ['ENTRA_ACTIVATION_EXTENSION', { ENTRA_ACTIVATION_EXTENSION: undefined }],
  ] as const) {
    describe(`sans ${nom}`, () => {
      const { h, g } = suite(env);
      it('503 sans aucune lecture Graph', async () => {
        expect((await h.callRh('GET', '/api/suivi')).status).toBe(503);
        expect(g().calls).toEqual([]);
      });
    });
  }
});

describe('GET /api/suivi : activer seulement à partir de la date d’arrivée (jour calculé dans TZ_METIER)', () => {
  // 2026-10-26 23:30 UTC = 2026-10-27 00:30 à Paris (CET) : le jour J dépend du fuseau.
  const MINUIT_PARIS = () => new Date('2026-10-26T23:30:00Z');
  const actionsDe = async (h: ReturnType<typeof harness>, hireDate: string | null) => {
    const id = h.ctx.graph.addPending(EXT, { givenName: 'Jour', surname: 'Test', statut: 'Validé', hireDate: hireDate ?? '2026-10-27', extras: hireDate === null ? { employeeHireDate: null } : undefined });
    const out = (await (await h.callRh('GET', '/api/suivi')).json()) as { demandes: { id: string; actions: string[] }[] };
    return out.demandes.find((d) => d.id === id)?.actions;
  };

  describe('fuseau Europe/Paris (défaut)', () => {
    const h = harness({}, { now: MINUIT_PARIS });
    beforeEach(async () => {
      if (h.ctx) await h.stop();
      await h.start();
    });
    afterAll(() => h.stop());

    it('le jour J et les jours passés : activer', async () => {
      expect(await actionsDe(h, '2026-10-27')).toEqual(['activer']); // jour J à Paris, encore la veille en UTC
      expect(await actionsDe(h, '2026-10-20')).toEqual(['activer']);
    });
    it('arrivée à venir : aucune action', async () => {
      expect(await actionsDe(h, '2026-10-28')).toEqual([]);
      expect(await actionsDe(h, '2026-11-03')).toEqual([]);
    });
    it('date d’arrivée absente : aucune action (la route la refuse aussi)', async () => {
      expect(await actionsDe(h, null)).toEqual([]);
    });
    it('ce que propose actions est ce que la route accepte : la veille du jour J, activer répond 409 avant toute écriture', async () => {
      const id = h.ctx.graph.addPending(EXT, { givenName: 'Veille', surname: 'Test', statut: 'Validé', hireDate: '2026-10-28' });
      expect((await h.callRh('POST', `/api/demandes/${id}/activer`)).status).toBe(409);
      expect(h.ctx.graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    });
  });

  describe('TZ_METIER=UTC : le même instant est encore la veille', () => {
    const h = harness({ TZ_METIER: 'UTC' }, { now: MINUIT_PARIS });
    beforeEach(async () => {
      if (h.ctx) await h.stop();
      await h.start();
    });
    afterAll(() => h.stop());
    it('arrivée le 27 : pas encore d’activer ; le 26 : activer', async () => {
      expect(await actionsDe(h, '2026-10-27')).toEqual([]);
      expect(await actionsDe(h, '2026-10-26')).toEqual(['activer']);
    });
  });
});
