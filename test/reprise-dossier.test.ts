import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ARRIVANTS_GROUP, DIR_ID, EXT, EXT_CREATOR, EXT_LIC, LICENSE_SKU, principal } from './helpers/ctx';
import { harness } from './helpers/harness';

// NOW (ctx) = 2026-10-27 10:00 UTC. Dossier par défaut : « {nom} {prenom} », ici « Test <Prénom> ».
const AUTRE_DIR = 'dddddddd-0000-4000-8000-0000000000d1';

function suite(opts: { withLibrary?: boolean } = {}) {
  const h = harness({}, opts);
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());
  const g = () => h.ctx.graph;
  const compte = (prenom: string, statut = 'Validé', o: { createur?: string; hireDate?: string } = {}) =>
    g().addPending(EXT, {
      givenName: prenom,
      surname: 'Test',
      statut,
      hireDate: o.hireDate ?? '2026-10-20',
      extras: { [EXT_LIC]: LICENSE_SKU, ...(o.createur ? { [EXT_CREATOR]: o.createur } : {}) },
    });
  const dossier = (prenom: string, nom = 'Test') => g().folders.set(`${nom} ${prenom}`, { id: `dossier-${prenom}`, folder: {} });
  const suivi = async (who: 'dir' | 'rh') => {
    const res = who === 'dir' ? await h.call('GET', '/api/suivi') : await h.callRh('GET', '/api/suivi');
    expect(res.status).toBe(200);
    return (await res.json()) as { demandes: { id: string; nom: string; statut: string; actions: string[] }[] };
  };
  const actions = (out: Awaited<ReturnType<typeof suivi>>, id: string) => out.demandes.find((d) => d.id === id)?.actions;
  const ecritures = () => g().calls.filter((c) => c.method !== 'GET');
  return { h, g, compte, dossier, suivi, actions, ecritures };
}

describe('GET /api/suivi : action reprendre pour un compte Validé sans dossier SharePoint', () => {
  const { h, g, compte, dossier, suivi, actions } = suite();

  it('proposée à la direction quand le dossier manque, pas quand il existe (casse du nom ignorée par SharePoint)', async () => {
    const sans = compte('Sans');
    const avec = compte('Avec');
    const casse = compte('Casse');
    dossier('Avec');
    g().folders.set('TEST CASSE', { id: 'x', folder: {} });
    const out = await suivi('dir');
    // La date d'arrivée est passée : la direction (qui a aussi le droit activer) voit activer en plus.
    expect(actions(out, sans)).toEqual(['activer', 'reprendre']);
    expect(actions(out, avec)).toEqual(['activer']);
    expect(actions(out, casse)).toEqual(['activer']);
  });

  it('une seule lecture de la racine pour toute la liste (pas une par compte), pages suivies', async () => {
    for (const p of ['A', 'B', 'C', 'D', 'E']) compte(`Compte${p}`);
    for (const p of ['A', 'B', 'C', 'D', 'E']) dossier(`Compte${p}`);
    g().folderPageSize = 2;
    const sans = compte('Sans');
    const out = await suivi('dir');
    // 5 dossiers par pages de 2 : trois lectures de la racine pour six comptes Validé, pas une par compte.
    expect(g().folderListings).toBe(3);
    expect(out.demandes.filter((d) => d.actions.includes('reprendre')).map((d) => d.id)).toEqual([sans]);
  });

  it('RH seul : jamais proposée, et la bibliothèque n’est pas lue (droit approuver requis, que Direction seule porte en plus d’activer)', async () => {
    const id = compte('Sans', 'Validé', { hireDate: '2026-10-27' });
    const out = await suivi('rh');
    expect(actions(out, id)).toEqual(['activer']);
    expect(g().folderListings).toBe(0);
  });

  it('une personne qui a les deux droits : activer (jour J) et reprendre', async () => {
    const id = compte('Sans', 'Validé', { hireDate: '2026-10-27' });
    const res = await h.callAs(['RH', 'Direction'], AUTRE_DIR, 'GET', '/api/suivi');
    const out = (await res.json()) as { demandes: { id: string; actions: string[] }[] };
    expect(out.demandes.find((d) => d.id === id)?.actions).toEqual(['activer', 'reprendre']);
  });

  it('aucun compte Validé : la bibliothèque n’est pas lue', async () => {
    compte('Attente', 'EnAttente');
    await suivi('dir');
    expect(g().folderListings).toBe(0);
  });

  it('lecture de la bibliothèque en échec : aucune action proposée (jamais à l’aveugle), la liste répond, l’échec est tracé sans nom', async () => {
    const id = compte('Sans');
    g().failOn.folderList = 403;
    const out = await suivi('dir');
    expect(actions(out, id)).toEqual(['activer']);
    expect(h.ctx.events.find((e) => e.action === 'demande.echec')).toMatchObject({ etape: 'suivi_dossiers', http: 403 });
    expect(JSON.stringify(h.ctx.events)).not.toContain('Test');
  });

  it('prénom et nom ne sont pas renvoyés, les champs de la demande ne changent pas', async () => {
    compte('Sans');
    const res = await h.call('GET', '/api/suivi');
    const text = await res.text();
    expect(text).not.toMatch(/prenom|famille|givenName|surname/);
    expect(Object.keys((JSON.parse(text) as { demandes: object[] }).demandes[0]!).sort()).toEqual(['actions', 'dateArrivee', 'etape', 'id', 'nom', 'poste', 'service', 'statut', 'typeContrat', 'upn']);
  });

  it('les statuts autres que Validé n’en ont pas', async () => {
    const attente = compte('Attente', 'EnAttente');
    const actif = compte('Actif', 'Actif');
    g().groups.set(ARRIVANTS_GROUP, new Set([actif]));
    const out = await suivi('dir');
    expect(actions(out, attente)).toEqual(['approuver', 'refuser']);
    expect(actions(out, actif)).toEqual(['regenerer']);
  });
});

describe('GET /api/suivi sans SharePoint configuré', () => {
  const { g, compte, suivi, actions } = suite({ withLibrary: false });
  it('aucune action reprendre, aucune lecture', async () => {
    const id = compte('Sans');
    expect(actions(await suivi('dir'), id)).toEqual(['activer']);
    expect(g().folderListings).toBe(0);
  });
});

describe('POST /api/demandes/:id/reprendre', () => {
  const { h, g, compte, dossier, suivi, actions, ecritures } = suite();

  it('recrée le dossier seulement : ni licence, ni groupe, ni statut ; la reprise disparaît de la liste', async () => {
    const id = compte('Sans');
    expect(actions(await suivi('dir'), id)).toEqual(['activer', 'reprendre']);
    const res = await h.call('POST', `/api/demandes/${id}/reprendre`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, statut: 'Validé', dossier: { cree: true } });
    expect([...g().folders.keys()]).toEqual(['Test Sans']);
    // Une seule écriture : le dossier. Pas de groupe de licence, pas de groupe des arrivants, pas d'écriture de statut.
    expect(ecritures().map((c) => `${c.method} ${c.path.replace(/sites\/.*\/root/, 'sites/…/root')}`)).toEqual(['POST /sites/…/root/children']);
    expect(g().users.get(id)!.props[EXT]).toBe('Validé');
    expect(actions(await suivi('dir'), id)).toEqual(['activer']);
  });

  it('trace la reprise et le dossier avec l’objectId seulement', async () => {
    const id = compte('Sans');
    await h.call('POST', `/api/demandes/${id}/reprendre`);
    const evts = h.ctx.events.filter((e) => ['demande.reprise_dossier', 'demande.dossier'].includes(e.action as string));
    expect(evts.map((e) => e.action)).toEqual(['demande.dossier', 'demande.reprise_dossier']);
    expect(evts.every((e) => e.actor === DIR_ID && e.cible === id)).toBe(true);
    expect(JSON.stringify(h.ctx.events)).not.toMatch(/Test Sans|sp\.test/);
  });

  it('idempotent : un dossier déjà là est réutilisé (cree: false)', async () => {
    const id = compte('Deja');
    dossier('Deja');
    const res = await h.call('POST', `/api/demandes/${id}/reprendre`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dossier: { cree: false } });
  });

  it('le créateur de la demande peut la reprendre (la reprise n’approuve rien)', async () => {
    const id = compte('Sans', 'Validé', { createur: DIR_ID });
    expect((await h.call('POST', `/api/demandes/${id}/reprendre`)).status).toBe(200);
  });

  it('droit approuver requis : RH seul 403, sans identité 401', async () => {
    const id = compte('Sans');
    expect((await h.callRh('POST', `/api/demandes/${id}/reprendre`)).status).toBe(403);
    expect((await fetch(`${h.base}/api/demandes/${id}/reprendre`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect(ecritures()).toEqual([]);
  });

  it('409 pour un compte qui n’est pas Validé (EnAttente, Actif) : rien d’écrit', async () => {
    const attente = compte('Attente', 'EnAttente');
    const actif = compte('Actif', 'Actif');
    for (const id of [attente, actif]) expect((await h.call('POST', `/api/demandes/${id}/reprendre`)).status).toBe(409);
    expect(ecritures()).toEqual([]);
  });

  it('identifiant invalide 400, compte inconnu 404, corps non JSON 415', async () => {
    expect((await h.call('POST', '/api/demandes/pas-un-guid/reprendre')).status).toBe(400);
    expect((await h.call('POST', '/api/demandes/cccccccc-0000-4000-8000-0000000000c1/reprendre')).status).toBe(404);
    const id = compte('Sans');
    expect((await fetch(`${h.base}/api/demandes/${id}/reprendre`, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-ms-client-principal': principal(['Direction'], DIR_ID) }, body: 'x' })).status).toBe(415);
  });

  it('SharePoint en échec : 502 avec l’étape, le compte reste Validé, on peut recommencer', async () => {
    const id = compte('Sans');
    g().failOn.folder = 403;
    const res = await h.call('POST', `/api/demandes/${id}/reprendre`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'dossier_sharepoint', statut: 'Validé' });
    expect(g().users.get(id)!.props[EXT]).toBe('Validé');
    g().failOn.folder = undefined;
    expect((await h.call('POST', `/api/demandes/${id}/reprendre`)).status).toBe(200);
  });
});

describe('POST /api/demandes/:id/reprendre sans SharePoint', () => {
  const { h, compte, ecritures } = suite({ withLibrary: false });
  it('503 sans rien lire ni écrire', async () => {
    const id = compte('Sans');
    expect((await h.call('POST', `/api/demandes/${id}/reprendre`)).status).toBe(503);
    expect(ecritures()).toEqual([]);
  });
});
