import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { buildFolderName } from '../src/folder';
import { DIR_ID, EXT, GROUP_ID, RH_ID } from './helpers/ctx';
import { harness } from './helpers/harness';

describe('Direction : personne', () => {
  const h = harness();
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());

  it('accepte le valideur désigné, refuse les autres', async () => {
    expect((await h.call('GET', '/api/demandes', DIR_ID)).status).toBe(200);
    const other = await h.call('GET', '/api/demandes', RH_ID);
    expect(other.status).toBe(403);
    expect(h.ctx.events.at(-1)).toMatchObject({ action: 'acces.refuse', reason: 'direction_non_valideur', actor: RH_ID });
  });

  it('401 sans identité', async () => {
    expect((await h.call('GET', '/api/demandes', DIR_ID, {}, { 'x-ms-client-principal': '' })).status).toBe(401);
  });
});

describe('Direction : groupe', () => {
  const h = harness({ DIRECTION_TYPE: 'group', DIRECTION_OBJECT_ID: GROUP_ID });
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());

  it('vérifie l’appartenance via checkMemberGroups', async () => {
    h.ctx.graph.groups.set(GROUP_ID, new Set([DIR_ID]));
    expect((await h.call('GET', '/api/demandes', DIR_ID)).status).toBe(200);
    expect((await h.call('GET', '/api/demandes', RH_ID)).status).toBe(403);
    const check = h.ctx.graph.calls.filter((c) => c.path.endsWith('/checkMemberGroups'));
    expect(check).toHaveLength(2);
    expect(check[0]?.body).toEqual({ groupIds: [GROUP_ID] });
  });
});

describe('Direction : non configurée', () => {
  const h = harness({ DIRECTION_TYPE: undefined, DIRECTION_OBJECT_ID: undefined });
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());

  it('ferme les routes (503) tant que la direction n’est pas décidée', async () => {
    expect((await h.call('GET', '/api/demandes')).status).toBe(503);
  });
});

describe('GET /api/demandes, valider, refuser', () => {
  const h = harness();
  let managerId: string;
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
    managerId = h.ctx.graph.addUser('chef@exemple.test', 'Camille Responsable');
  });
  afterAll(() => h.stop());

  const pending = (given = 'Anna', sur = 'Martin', statut = 'EnAttente') =>
    h.ctx.graph.addPending(EXT, { givenName: given, surname: sur, statut, managerId });

  it('liste uniquement les EnAttente, avec les champs utiles', async () => {
    const id = pending();
    pending('Luc', 'Valide', 'Validé');
    const res = await h.call('GET', '/api/demandes');
    expect(await res.json()).toEqual({
      demandes: [
        {
          id,
          nom: 'Anna Martin',
          poste: 'Comptable',
          service: 'Finance',
          manager: { id: managerId, displayName: 'Camille Responsable' },
          dateArrivee: '2026-11-03',
        },
      ],
      tronque: false,
    });
    const call = h.ctx.graph.calls.find((c) => c.filter?.includes(EXT))!;
    expect(call.filter).toBe(`${EXT} eq 'EnAttente'`);
    expect(call.headers.ConsistencyLevel).toBe('eventual');
  });

  it('valide : statut Validé puis dossier « {nom} {prenom} »', async () => {
    const id = pending();
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { statut: string; dossier: { cree: boolean }; reprise: boolean };
    expect(out).toMatchObject({ statut: 'Validé', reprise: false, dossier: { cree: true } });
    expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Validé');
    expect([...h.ctx.graph.folders.keys()]).toEqual(['Martin Anna']);
    const logged = JSON.stringify(h.ctx.events);
    expect(h.ctx.events.map((e) => e.action)).toEqual(['demande.validee', 'demande.dossier']);
    expect(h.ctx.events.every((e) => e.actor === DIR_ID)).toBe(true);
    for (const pii of ['Martin', 'Anna', 'sp.test']) expect(logged).not.toContain(pii);
  });

  it('est idempotent si le dossier existe déjà', async () => {
    const id = pending();
    h.ctx.graph.folders.set('Martin Anna', { id: 'deja-la', folder: {} });
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dossier: { id: 'deja-la', cree: false } });
    expect(h.ctx.graph.folders.size).toBe(1);
  });

  it('502 si le nom existe mais n’est pas un dossier', async () => {
    const id = pending();
    h.ctx.graph.folders.set('Martin Anna', { id: 'fichier' });
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'dossier_sharepoint', statut: 'Validé' });
  });

  it('SharePoint en échec : garde Validé, 502 avec l’étape, puis reprise possible', async () => {
    const id = pending();
    h.ctx.graph.failOn.folder = 403;
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'Le service a échoué ; l’action n’a pas abouti',
      etape: 'dossier_sharepoint',
      statut: 'Validé',
    });
    expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Validé');
    expect(h.ctx.events.at(-1)).toMatchObject({ action: 'demande.echec', etape: 'dossier_sharepoint', cible: id, http: 403 });

    h.ctx.graph.failOn.folder = undefined;
    const retry = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ reprise: true, dossier: { cree: true } });
  });

  it('503 avant toute écriture si SharePoint n’est pas configuré', async () => {
    const off = harness({}, { withLibrary: false });
    await off.start();
    const id = off.ctx.graph.addPending(EXT, { givenName: 'Eva', surname: 'Test' });
    expect((await off.call('POST', `/api/demandes/${id}/valider`)).status).toBe(503);
    expect(off.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
    await off.stop();
  });

  it('refuser sans motif : 400 et rien n’est supprimé', async () => {
    const id = pending();
    for (const body of [{}, { motif: '   ' }, { motif: 42 }]) {
      expect((await h.call('POST', `/api/demandes/${id}/refuser`, DIR_ID, body)).status).toBe(400);
    }
    expect(h.ctx.graph.deleted).toEqual([]);
  });

  it('refuse : trace la longueur du motif (pas le texte) puis supprime le compte', async () => {
    const id = pending();
    const motif = 'Budget gelé pour ce poste';
    const res = await h.call('POST', `/api/demandes/${id}/refuser`, DIR_ID, { motif });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, supprime: true, recuperableJours: 30 });
    expect(h.ctx.graph.deleted).toEqual([id]);
    expect(h.ctx.events.map((e) => e.action)).toEqual(['demande.refusee', 'demande.compte_supprime']);
    expect(h.ctx.events[0]).toMatchObject({ motifLongueur: motif.length, cible: id, actor: DIR_ID });
    expect(JSON.stringify(h.ctx.events)).not.toContain('Budget');
  });

  it('échec de suppression : 502 avec l’étape, le compte reste EnAttente', async () => {
    const id = pending();
    h.ctx.graph.failOn.delete = 403;
    const res = await h.call('POST', `/api/demandes/${id}/refuser`, DIR_ID, { motif: 'x' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'suppression_compte' });
    expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
  });

  it('409 si le statut n’est pas EnAttente', async () => {
    const valide = pending('Luc', 'Valide', 'Validé');
    const refuse = pending('Rémi', 'Refuse', 'Refusé');
    expect((await h.call('POST', `/api/demandes/${valide}/refuser`, DIR_ID, { motif: 'x' })).status).toBe(409);
    const res = await h.call('POST', `/api/demandes/${refuse}/valider`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ statut: 'Refusé' });
    expect(h.ctx.graph.deleted).toEqual([]);
    expect(h.ctx.graph.folders.size).toBe(0);
  });

  it('409 sans suppression sur un compte hors onboarding ou déjà actif', async () => {
    const autre = h.ctx.graph.addUser('quelquun@exemple.test', 'Quelqu’un'); // actif, sans statut
    expect((await h.call('POST', `/api/demandes/${autre}/refuser`, DIR_ID, { motif: 'x' })).status).toBe(409);
    const actif = pending('Zoé', 'Active');
    h.ctx.graph.users.get(actif)!.accountEnabled = true;
    expect((await h.call('POST', `/api/demandes/${actif}/refuser`, DIR_ID, { motif: 'x' })).status).toBe(409);
    expect(h.ctx.graph.deleted).toEqual([]);
  });

  it('404 si inconnue, 400 si id invalide, 415 hors JSON', async () => {
    expect((await h.call('POST', '/api/demandes/11111111-1111-4111-8111-111111111111/valider')).status).toBe(404);
    expect((await h.call('POST', '/api/demandes/pas-un-guid/valider')).status).toBe(400);
    const id = pending();
    const form = await h.call('POST', `/api/demandes/${id}/valider`, DIR_ID, 'a=b', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(415);
  });
});

describe('dossier et config', () => {
  it('nettoie le nom de dossier', () => {
    expect(buildFolderName('{nom} {prenom}', { nom: 'Martin', prenom: 'Anna', id: 'x' })).toBe('Martin Anna');
    expect(buildFolderName('{nom}/{prenom}: *?', { nom: 'D\\Cruz', prenom: 'Éloïse.', id: 'x' })).toBe('DCruzÉloïse');
    expect(() => buildFolderName('{nom}', { nom: '..', prenom: '', id: 'x' })).toThrow();
  });

  it('valide le motif et les ids SharePoint, défaut « {nom} {prenom} »', () => {
    expect(loadConfig({}).sharePoint.folderPattern).toBe('{nom} {prenom}');
    expect(() => loadConfig({ SHAREPOINT_FOLDER_PATTERN: 'Dossier' })).toThrow();
    expect(() => loadConfig({ SHAREPOINT_FOLDER_PATTERN: '{nom} {upn}' })).toThrow();
    expect(() => loadConfig({ SHAREPOINT_DRIVE_ID: '../x' })).toThrow();
    expect(() => loadConfig({ DIRECTION_OBJECT_ID: 'pas-un-guid' })).toThrow();
  });
});
