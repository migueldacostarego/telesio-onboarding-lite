import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ARRIVANTS_GROUP, DIR_ID, EXT, EXT_CREATOR, EXT_LIC, LICENSE_SKU, RH_ID } from './helpers/ctx';
import { harness } from './helpers/harness';

// NOW (ctx) = 2026-10-27 10:00 UTC.
const AUTRE_ID = 'dddddddd-0000-4000-8000-0000000000d1';
const ADMIN_ID = 'eeeeeeee-0000-4000-8000-0000000000e1';

/** Contexte commun : un manager, des comptes d'onboarding à tous les statuts, et les écritures Graph observées. */
function suite(env: Record<string, string | undefined> = {}) {
  const h = harness(env);
  let managerId = '';
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
    managerId = h.ctx.graph.addUser('chef@exemple.test', 'Camille Responsable');
  });
  afterAll(() => h.stop());
  const g = () => h.ctx.graph;
  const compte = (prenom: string, statut: string, o: { createur?: string; hireDate?: string } = {}) =>
    g().addPending(EXT, {
      givenName: prenom,
      surname: 'Test',
      statut,
      hireDate: o.hireDate ?? '2026-10-20',
      enabled: statut === 'Actif' || statut === 'Terminé',
      managerId,
      extras: { [EXT_LIC]: LICENSE_SKU, ...(o.createur ? { [EXT_CREATOR]: o.createur } : {}) },
    });
  const body = () => ({ prenom: 'Éloïse', nom: 'Dupont', dateArrivee: '2026-11-03', poste: 'Comptable', service: 'Finance', managerId, licence: LICENSE_SKU });
  const ecritures = () => g().calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/checkMemberGroups'));
  const refus = () => h.ctx.events.filter((e) => e.action === 'acces.refuse');
  return { h, g, compte, body, ecritures, refus };
}

describe('POST /api/demandes : droit creer (RH ou Direction)', () => {
  const { h, g, body, ecritures, refus } = suite();
  const creer = (roles: string[], oid: string) => h.callAs(roles, oid, 'POST', '/api/demandes', body());

  it('RH : créée, avec son objectId enregistré sur le compte dans le même POST', async () => {
    const res = await creer(['RH'], RH_ID);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const posted = g().calls.find((c) => c.method === 'POST' && c.path === '/users')!.body as Record<string, unknown>;
    expect(posted).toMatchObject({ [EXT]: 'EnAttente', [EXT_LIC]: LICENSE_SKU, [EXT_CREATOR]: RH_ID });
    expect(g().users.get(id)!.props[EXT_CREATOR]).toBe(RH_ID);
    expect(ecritures().map((c) => c.method)).toEqual(['POST', 'PUT']);
  });

  it('Direction : créée aussi, au nom de la personne qui saisit', async () => {
    const res = await creer(['Direction'], DIR_ID);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(g().users.get(id)!.props[EXT_CREATOR]).toBe(DIR_ID);
  });

  it('RH et Direction : créée', async () => {
    expect((await creer(['RH', 'Direction'], AUTRE_ID)).status).toBe(201);
  });

  it('sans rôle, avec un rôle étranger, ou identité sans rôle : 403 droit_manquant, rien n’est écrit, refus tracé (objectId seulement)', async () => {
    for (const [roles, oid] of [[[], ADMIN_ID], [['Autre'], ADMIN_ID], [[], DIR_ID]] as const) {
      const res = await creer([...roles], oid);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Accès refusé', code: 'droit_manquant' });
    }
    expect(ecritures()).toEqual([]);
    expect(g().calls).toEqual([]);
    expect(refus()).toHaveLength(3);
    expect(refus()[0]).toEqual({ action: 'acces.refuse', outcome: 'refuse', route: 'POST /api/demandes', actor: ADMIN_ID, reason: 'droit_manquant', droit: 'creer' });
    const logged = JSON.stringify(h.ctx.events);
    expect(logged).not.toMatch(/Éloïse|Dupont|exemple\.test/);
  });

  it('401 sans identité', async () => {
    expect((await fetch(`${h.base}/api/demandes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) })).status).toBe(401);
  });
});

describe('POST /api/demandes : extension du créateur absente', () => {
  const { h, g, body } = suite({ ENTRA_CREATOR_EXTENSION: undefined });

  it('503 avant toute lecture ou écriture : l’auto-approbation ne serait pas contrôlable', async () => {
    const res = await h.callAs(['RH'], RH_ID, 'POST', '/api/demandes', body());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('ENTRA_CREATOR_EXTENSION');
    expect(g().calls).toEqual([]);
  });
});

describe('GET /api/annuaire et /api/licences : droit creer (Direction saisit aussi)', () => {
  const { h, refus } = suite();

  it('RH et Direction y accèdent', async () => {
    for (const roles of [['RH'], ['Direction']]) {
      expect((await h.callAs(roles, RH_ID, 'GET', '/api/licences')).status).toBe(200);
      expect((await h.callAs(roles, RH_ID, 'GET', '/api/annuaire?q=ca')).status).toBe(200);
    }
  });

  it('sans droit : 403 tracé avec le droit manquant', async () => {
    expect((await h.callAs(['Autre'], ADMIN_ID, 'GET', '/api/licences')).status).toBe(403);
    expect((await h.callAs([], ADMIN_ID, 'GET', '/api/annuaire?q=ca')).status).toBe(403);
    expect(refus().map((e) => [e.route, e.droit, e.actor])).toEqual([
      ['GET /api/licences', 'creer', ADMIN_ID],
      ['GET /api/annuaire', 'creer', ADMIN_ID],
    ]);
  });
});

describe('GET /api/suivi : droit acces et actions calculées pour la personne connectée', () => {
  const { h, g, compte, refus } = suite();
  const suivi = async (roles: string[], oid: string) => {
    const res = await h.callAs(roles, oid, 'GET', '/api/suivi');
    expect(res.status).toBe(200);
    return (await res.json()) as { demandes: { id: string; statut: string; actions: string[] }[] };
  };
  const actions = (out: Awaited<ReturnType<typeof suivi>>, id: string) => out.demandes.find((d) => d.id === id)?.actions;

  it('RH et Direction y accèdent ; sans droit, 403 tracé avec le droit acces', async () => {
    expect((await h.callAs(['RH'], RH_ID, 'GET', '/api/suivi')).status).toBe(200);
    expect((await h.callAs(['Direction'], DIR_ID, 'GET', '/api/suivi')).status).toBe(200);
    for (const [roles, oid] of [[[], ADMIN_ID], [['Autre'], ADMIN_ID], [[], DIR_ID]] as const) {
      expect((await h.callAs([...roles], oid, 'GET', '/api/suivi')).status).toBe(403);
    }
    expect(refus()).toHaveLength(3);
    expect(refus()[0]).toMatchObject({ route: 'GET /api/suivi', actor: ADMIN_ID, reason: 'droit_manquant', droit: 'acces' });
  });

  it('EnAttente : approuver et refuser pour Direction seulement', async () => {
    const id = compte('Attente', 'EnAttente', { createur: RH_ID });
    expect(actions(await suivi(['Direction'], DIR_ID), id)).toEqual(['approuver', 'refuser']);
    expect(actions(await suivi(['RH'], AUTRE_ID), id)).toEqual([]);
    expect(actions(await suivi(['RH', 'Direction'], AUTRE_ID), id)).toEqual(['approuver', 'refuser']);
  });

  it('EnAttente créée par la personne connectée : ni approuver ni refuser, même avec le droit (casse de l’objectId ignorée)', async () => {
    const id = compte('Propre', 'EnAttente', { createur: DIR_ID.toUpperCase() });
    expect(actions(await suivi(['Direction'], DIR_ID), id)).toEqual([]);
    // Une autre personne de la direction les voit.
    expect(actions(await suivi(['Direction'], AUTRE_ID), id)).toEqual(['approuver', 'refuser']);
  });

  it('EnAttente sans créateur (antérieure à l’extension) : proposée, le contrôle n’est pas possible', async () => {
    const id = compte('Ancienne', 'EnAttente');
    expect(actions(await suivi(['Direction'], DIR_ID), id)).toEqual(['approuver', 'refuser']);
  });

  it('Validé : activer pour RH seulement, y compris pour le créateur', async () => {
    const id = compte('Valide', 'Validé', { createur: RH_ID });
    expect(actions(await suivi(['RH'], RH_ID), id)).toEqual(['activer']);
    expect(actions(await suivi(['Direction'], DIR_ID), id)).toEqual([]);
    expect(actions(await suivi(['RH', 'Direction'], AUTRE_ID), id)).toEqual(['activer']);
  });

  it('Actif : regenerer pour RH seulement (nouveau mot de passe temporaire) ; Terminé : aucune action', async () => {
    const actif = compte('Actif', 'Actif');
    g().groups.set(ARRIVANTS_GROUP, new Set([actif]));
    const fini = g().addPending(EXT, { givenName: 'Fini', surname: 'Test', statut: 'Terminé', hireDate: '2026-10-20', enabled: true, extras: { extension_0123456789abcdef0123456789abcdef_activationOnboarding: '2026-10-25T10:00:00Z' } });
    const out = await suivi(['RH', 'Direction'], AUTRE_ID);
    expect(actions(out, actif)).toEqual(['regenerer']);
    expect(actions(out, fini)).toEqual([]);
    const direction = await suivi(['Direction'], DIR_ID);
    expect(actions(direction, actif)).toEqual([]);
    expect(actions(direction, fini)).toEqual([]);
    expect(actions(await suivi(['RH'], RH_ID), actif)).toEqual(['regenerer']);
  });

  it('un seul champ de plus par demande, et l’objectId du créateur n’est jamais renvoyé', async () => {
    compte('Attente', 'EnAttente', { createur: RH_ID });
    const res = await h.callAs(['Direction'], DIR_ID, 'GET', '/api/suivi');
    const text = await res.text();
    expect(text).not.toContain(RH_ID);
    expect(text).not.toContain('createur');
    expect(Object.keys((JSON.parse(text) as { demandes: object[] }).demandes[0]!).sort()).toEqual(['actions', 'dateArrivee', 'etape', 'id', 'nom', 'poste', 'service', 'statut']);
  });

  it('lit le créateur des EnAttente dans Graph (extension dans $select), pas celui des autres statuts', async () => {
    compte('Attente', 'EnAttente', { createur: RH_ID });
    await suivi(['Direction'], DIR_ID);
    const lists = g().calls.filter((c) => c.method === 'GET' && c.path === '/users');
    const select = (statut: string) => lists.find((c) => c.filter?.endsWith(`'${statut}'`))?.select ?? '';
    expect(select('EnAttente')).toContain(EXT_CREATOR);
    for (const s of ['Validé', 'Actif', 'Terminé']) expect(select(s)).not.toContain(EXT_CREATOR);
  });
});

describe('GET /api/suivi : extension du créateur absente', () => {
  const { h, g } = suite({ ENTRA_CREATOR_EXTENSION: undefined });
  it('503 sans lecture Graph', async () => {
    expect((await h.callAs(['RH'], RH_ID, 'GET', '/api/suivi')).status).toBe(503);
    expect(g().calls).toEqual([]);
  });
});

describe('valider et refuser : jamais sa propre demande', () => {
  const { h, g, compte, ecritures } = suite();
  const valider = (id: string, oid = DIR_ID) => h.call('POST', `/api/demandes/${id}/valider`, oid);
  const refuser = (id: string, oid = DIR_ID) => h.call('POST', `/api/demandes/${id}/refuser`, oid, { motif: 'Dossier incomplet' });
  const AUTO = { error: 'Vous ne pouvez pas valider ni refuser une demande que vous avez créée', code: 'auto_approbation' };

  it('le créateur, porteur du rôle Direction, reçoit 403 auto_approbation : rien n’est écrit, le compte reste EnAttente', async () => {
    const id = compte('Propre', 'EnAttente', { createur: DIR_ID });
    for (const appel of [valider, refuser]) {
      const res = await appel(id);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(AUTO);
    }
    expect(ecritures()).toEqual([]);
    expect(g().users.get(id)!.props[EXT]).toBe('EnAttente');
    expect(g().deleted).toEqual([]);
  });

  it('refus tracé : objectId de l’acteur et du compte, opération, sans nom', async () => {
    const id = compte('Propre', 'EnAttente', { createur: DIR_ID });
    await valider(id);
    await refuser(id);
    const traces = h.ctx.events.filter((e) => e.action === 'demande.auto_approbation');
    expect(traces).toEqual([
      { action: 'demande.auto_approbation', actor: DIR_ID, outcome: 'refuse', cible: id, operation: 'valider' },
      { action: 'demande.auto_approbation', actor: DIR_ID, outcome: 'refuse', cible: id, operation: 'refuser' },
    ]);
    expect(JSON.stringify(h.ctx.events)).not.toMatch(/Propre|Test|exemple\.test|Dossier incomplet/);
  });

  it('la comparaison ignore la casse de l’objectId', async () => {
    const id = compte('Propre', 'EnAttente', { createur: DIR_ID.toUpperCase() });
    expect((await valider(id)).status).toBe(403);
  });

  it('la direction garde ses contrôles : demande créée par quelqu’un d’autre, ou sans créateur (antérieure), validée ou refusée normalement', async () => {
    const autre = compte('Autre', 'EnAttente', { createur: RH_ID });
    expect((await valider(autre)).status).toBe(200);
    const ancienne = compte('Ancienne', 'EnAttente');
    expect((await valider(ancienne)).status).toBe(200);
    const aRefuser = compte('Refus', 'EnAttente', { createur: RH_ID });
    expect((await refuser(aRefuser)).status).toBe(200);
    expect(g().deleted).toEqual([aRefuser]);
  });

  it('le droit approuver et les contrôles de statut restent : 403 pour RH seul, 404 pour un compte inconnu, 409 hors EnAttente', async () => {
    const id = compte('Propre', 'EnAttente', { createur: RH_ID });
    const rh = await h.callAs(['RH'], RH_ID, 'POST', `/api/demandes/${id}/valider`);
    expect(rh.status).toBe(403);
    expect(await rh.json()).toEqual({ error: 'Accès refusé', code: 'droit_manquant' });
    expect(h.ctx.events.at(-1)).toMatchObject({ action: 'acces.refuse', reason: 'droit_manquant', droit: 'approuver', actor: RH_ID });
    expect((await valider('00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    const actif = compte('Actif', 'Actif');
    expect((await refuser(actif)).status).toBe(409);
  });

  it('tout porteur du rôle Direction valide les demandes des autres, pas seulement DIR_ID', async () => {
    const id = compte('Autre', 'EnAttente', { createur: RH_ID });
    expect((await valider(id, AUTRE_ID)).status).toBe(200);
  });

  it('lit le créateur dans Graph (extension dans $select)', async () => {
    const id = compte('Autre', 'EnAttente', { createur: RH_ID });
    await valider(id);
    const read = g().calls.find((c) => c.method === 'GET' && c.path === `/users/${id}`);
    expect(read?.select).toContain(EXT_CREATOR);
  });
});

describe('les actions proposées par le suivi sont celles que les routes acceptent', () => {
  const { h, compte } = suite();

  it('approuver proposé : valider aboutit ; non proposé au créateur : valider répond 403 auto_approbation', async () => {
    const id = compte('Attente', 'EnAttente', { createur: RH_ID });
    const propres = compte('Propre', 'EnAttente', { createur: AUTRE_ID });
    const offre = async (oid: string, cible: string) => {
      const out = (await (await h.callAs(['Direction'], oid, 'GET', '/api/suivi')).json()) as { demandes: { id: string; actions: string[] }[] };
      return out.demandes.find((d) => d.id === cible)?.actions;
    };
    expect(await offre(AUTRE_ID, id)).toEqual(['approuver', 'refuser']);
    expect((await h.callAs(['Direction'], AUTRE_ID, 'POST', `/api/demandes/${id}/valider`)).status).toBe(200);

    expect(await offre(AUTRE_ID, propres)).toEqual([]);
    const refus = await h.callAs(['Direction'], AUTRE_ID, 'POST', `/api/demandes/${propres}/valider`);
    expect(refus.status).toBe(403);
    expect(((await refus.json()) as { code: string }).code).toBe('auto_approbation');
  });

  it('RH seul : aucune action sur les EnAttente, et valider répond 403', async () => {
    const id = compte('Attente', 'EnAttente', { createur: AUTRE_ID });
    const out = (await (await h.callAs(['RH'], RH_ID, 'GET', '/api/suivi')).json()) as { demandes: { id: string; actions: string[] }[] };
    expect(out.demandes.find((d) => d.id === id)?.actions).toEqual([]);
    expect((await h.callAs(['RH'], RH_ID, 'POST', `/api/demandes/${id}/valider`)).status).toBe(403);
  });
});

describe('valider et refuser : extension du créateur absente', () => {
  const { h, g, compte } = suite({ ENTRA_CREATOR_EXTENSION: undefined });
  it('503 sans lecture ni écriture : le contrôle d’auto-approbation ne peut pas s’appliquer', async () => {
    const id = compte('Attente', 'EnAttente', { createur: RH_ID });
    g().calls.length = 0;
    expect((await h.call('POST', `/api/demandes/${id}/valider`, DIR_ID)).status).toBe(503);
    expect((await h.call('POST', `/api/demandes/${id}/refuser`, DIR_ID, { motif: 'x' })).status).toBe(503);
    expect(g().calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/checkMemberGroups'))).toEqual([]);
    expect(g().calls.some((c) => c.path === `/users/${id}`)).toBe(false);
  });
});

describe('activer, régénérer, terminer et la liste des activations : droit activer', () => {
  const { h, g, compte, ecritures, refus } = suite();
  const routes = (id: string): [string, string, object][] => [
    ['GET', '/api/activations', {}],
    ['POST', `/api/demandes/${id}/activer`, {}],
    ['POST', `/api/demandes/${id}/regenerer`, { motif: 'code_perdu' }],
    ['POST', `/api/demandes/${id}/terminer`, {}],
  ];

  it('Direction seule, rôle étranger ou aucun rôle : 403 droit_manquant, compte inchangé, refus tracés avec le droit', async () => {
    const id = compte('Valide', 'Validé', { hireDate: '2026-10-27' });
    let n = 0;
    for (const [roles, oid] of [[['Direction'], DIR_ID], [['Autre'], ADMIN_ID], [[], ADMIN_ID]] as const) {
      for (const [method, path, payload] of routes(id)) {
        const res = await h.callAs([...roles], oid, method, path, payload);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Accès refusé', code: 'droit_manquant' });
        n++;
      }
    }
    expect(refus()).toHaveLength(n);
    expect(refus().every((e) => e.droit === 'activer' && e.reason === 'droit_manquant')).toBe(true);
    expect(refus().map((e) => e.route).slice(0, 4)).toEqual(['GET /api/activations', `POST /api/demandes/${id}/activer`, `POST /api/demandes/${id}/regenerer`, `POST /api/demandes/${id}/terminer`]);
    expect(g().users.get(id)!.props[EXT]).toBe('Validé');
    expect(ecritures()).toEqual([]);
    expect(g().passwords.size).toBe(0);
  });

  it('RH, seul ou avec Direction : accès (activer rend le mot de passe, la liste répond)', async () => {
    for (const roles of [['RH'], ['RH', 'Direction']]) {
      const id = compte(`Valide${roles.length}`, 'Validé', { hireDate: '2026-10-27' });
      expect((await h.callAs(roles, AUTRE_ID, 'GET', '/api/activations')).status).toBe(200);
      const res = await h.callAs(roles, AUTRE_ID, 'POST', `/api/demandes/${id}/activer`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { statut: string }).statut).toBe('Actif');
    }
  });

  it('le créateur de la demande peut l’activer : l’auto-approbation ne concerne que valider et refuser', async () => {
    const id = compte('Valide', 'Validé', { createur: RH_ID, hireDate: '2026-10-27' });
    expect((await h.callRh('POST', `/api/demandes/${id}/activer`)).status).toBe(200);
  });
});

describe('noms de rôle configurables : les routes suivent RH_ROLE et DIRECTION_ROLE', () => {
  const { h, body, compte } = suite({ RH_ROLE: 'RessourcesHumaines', DIRECTION_ROLE: 'Dirigeants' });

  it('création : les noms configurés comptent, pas RH ni Direction', async () => {
    expect((await h.callAs(['RessourcesHumaines'], RH_ID, 'POST', '/api/demandes', body())).status).toBe(201);
    expect((await h.callAs(['Dirigeants'], DIR_ID, 'POST', '/api/demandes', body())).status).toBe(201);
    expect((await h.callAs(['RH', 'Direction'], AUTRE_ID, 'POST', '/api/demandes', body())).status).toBe(403);
  });

  it('activation et suivi suivent les mêmes noms', async () => {
    const id = compte('Valide', 'Validé', { hireDate: '2026-10-27' });
    expect((await h.callAs(['RH'], RH_ID, 'POST', `/api/demandes/${id}/activer`)).status).toBe(403);
    expect((await h.callAs(['Dirigeants'], DIR_ID, 'POST', `/api/demandes/${id}/activer`)).status).toBe(403);
    expect((await h.callAs(['RessourcesHumaines'], RH_ID, 'POST', `/api/demandes/${id}/activer`)).status).toBe(200);
    expect((await h.callAs(['RH'], RH_ID, 'GET', '/api/suivi')).status).toBe(403);
    expect((await h.callAs(['Dirigeants'], DIR_ID, 'GET', '/api/suivi')).status).toBe(200);
  });
});
