import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { buildFolderName } from '../src/folder';
import { ARRIVANTS_GROUP, DIR_ID, EXT, EXT_LIC, GROUP_ID, LICENSE_GROUP, LICENSE_GROUP_B, LICENSE_SKU, LICENSE_SKU_B, LICENSE_SKU_ZERO, RH_ID } from './helpers/ctx';
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

  const pending = (given = 'Anna', sur = 'Martin', statut = 'EnAttente', licence: string | null = LICENSE_SKU) =>
    h.ctx.graph.addPending(EXT, { givenName: given, surname: sur, statut, managerId, extras: licence ? { [EXT_LIC]: licence } : {} });

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
    expect(h.ctx.events.map((e) => e.action)).toEqual(['licence.groupe_ajout', 'licence.attribuee', 'demande.arrivants_ajout', 'demande.validee', 'demande.dossier']);
    // Groupe des arrivants (cible de la politique TAP) dès la validation : réplication acquise avant le jour J.
    expect(h.ctx.graph.groups.get(ARRIVANTS_GROUP)?.has(id)).toBe(true);
    expect(h.ctx.events.every((e) => e.actor === DIR_ID)).toBe(true);
    for (const pii of ['Martin', 'Anna', 'sp.test']) expect(logged).not.toContain(pii);
  });

  describe('licence', () => {
    const members = () => h.ctx.graph.groups.get(LICENSE_GROUP) ?? new Set<string>();
    const sku = () => h.ctx.graph.skus.get(LICENSE_SKU)!;

    it('licence disponible : ajout au groupe, état Active, puis statut et dossier', async () => {
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ statut: 'Validé', licence: { deja: false }, reprise: false });
      expect(members().has(id)).toBe(true);
      expect(sku().consumed).toBe(2);
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Validé');
      // Le décompte précède toute écriture : lecture des SKU, ajout au groupe de licence, puis à celui des arrivants, puis PATCH du statut.
      const order = h.ctx.graph.calls.filter((c) => c.method !== 'GET' || c.path === '/subscribedSkus').map((c) => `${c.method} ${c.path}`);
      expect(order.slice(0, 4)).toEqual([
        'GET /subscribedSkus',
        `POST /groups/${LICENSE_GROUP}/members/$ref`,
        `POST /groups/${ARRIVANTS_GROUP}/members/$ref`,
        expect.stringMatching(/^PATCH \/users\//),
      ]);
      const events = JSON.stringify(h.ctx.events);
      for (const pii of ['Martin', 'Anna', 'exemple.test']) expect(events).not.toContain(pii);
      expect(h.ctx.events.find((e) => e.action === 'licence.attribuee')).toMatchObject({ cible: id, groupe: LICENSE_GROUP, sku: LICENSE_SKU, actor: DIR_ID });
    });

    it('ajoute au groupe du SKU choisi, pas à un autre', async () => {
      const id = pending('Béa', 'Autre', 'EnAttente', LICENSE_SKU_B);
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(200);
      expect(h.ctx.graph.groups.get(LICENSE_GROUP_B)?.has(id)).toBe(true);
      expect(members().size).toBe(0);
      expect(h.ctx.graph.skus.get(LICENSE_SKU_B)!.consumed).toBe(1);
      expect(sku().consumed).toBe(1);
      expect(h.ctx.events.find((e) => e.action === 'licence.attribuee')).toMatchObject({ groupe: LICENSE_GROUP_B, sku: LICENSE_SKU_B });
    });

    it('SKU choisi à 0 : 409 sans écriture, même si les autres licences sont libres', async () => {
      const id = pending('Zoé', 'Zero', 'EnAttente', LICENSE_SKU_ZERO);
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Aucune licence disponible', code: 'licence_indisponible' });
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
      expect(h.ctx.graph.calls.some((c) => c.method !== 'GET')).toBe(false);
    });

    it('409 si la demande n’a pas de licence choisie ou si elle n’est plus proposée', async () => {
      const sans = pending('Luc', 'Ancien', 'EnAttente', null);
      const retiree = pending('Eva', 'Retiree', 'EnAttente', 'ffffffff-0000-4000-8000-000000000009');
      for (const id of [sans, retiree]) {
        const res = await h.call('POST', `/api/demandes/${id}/valider`);
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'licence_inconnue' });
        expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
      }
      expect(h.ctx.graph.calls.some((c) => c.method !== 'GET')).toBe(false);
    });

    it('attend le traitement asynchrone par groupe', async () => {
      h.ctx.graph.licensePendingReads = 2;
      const id = pending();
      expect((await h.call('POST', `/api/demandes/${id}/valider`)).status).toBe(200);
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Validé');
    });

    it('0 licence : 409 « Aucune licence disponible », statut inchangé, aucune écriture', async () => {
      sku().consumed = sku().enabled;
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Aucune licence disponible', code: 'licence_indisponible' });
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
      expect(members().size).toBe(0);
      expect(h.ctx.graph.folders.size).toBe(0);
      expect(h.ctx.graph.calls.some((c) => c.method !== 'GET')).toBe(false);
      expect(h.ctx.events.at(-1)).toMatchObject({ action: 'licence.indisponible', outcome: 'refuse', cible: id, enabled: 5, consumed: 5 });
    });

    it('CountViolation après l’ajout : retrait du groupe, 409, statut inchangé', async () => {
      h.ctx.graph.licenseOutcome = 'CountViolation';
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'Aucune licence disponible' });
      expect(members().has(id)).toBe(false);
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
      expect(h.ctx.graph.folders.size).toBe(0);
      expect(h.ctx.events.map((e) => e.action)).toEqual(['licence.groupe_ajout', 'licence.refusee', 'licence.groupe_retrait']);
      expect(h.ctx.events[1]).toMatchObject({ code: 'CountViolation' });
    });

    it('autre erreur d’attribution : retrait du groupe, 502 avec la raison', async () => {
      h.ctx.graph.licenseOutcome = 'ProhibitedInUsageLocationViolation';
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ etape: 'licence_attribution', raison: 'ProhibitedInUsageLocationViolation' });
      expect(members().has(id)).toBe(false);
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
    });

    it('CountViolation et retrait impossible : 502 à l’étape de retrait, statut inchangé', async () => {
      h.ctx.graph.licenseOutcome = 'CountViolation';
      h.ctx.graph.failOn.groupRemove = 403;
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ etape: 'licence_retrait_groupe' });
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
    });

    it('traitement trop lent : 202, le compte reste dans le groupe et la reprise aboutit sans recompter', async () => {
      h.ctx.graph.licensePendingReads = 99;
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ message: 'Licence en cours d’attribution, revalidez dans une minute', code: 'licence_en_cours', etape: 'licence_verification' });
      expect(members().has(id)).toBe(true);
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
      // Aucune entrée lue pendant toute la fenêtre : la trace le dit (1 lecture avant l'ajout, 4 après).
      const expiree = h.ctx.events.find((e) => e.action === 'licence.verification_expiree');
      expect(expiree).toMatchObject({ cible: id, groupe: LICENSE_GROUP, sku: LICENSE_SKU, lectures: 5, entree: false, entrees: 0 });
      expect(expiree).toMatchObject({ etat: undefined, erreur: undefined, parGroupe: undefined });

      h.ctx.graph.licensePendingReads = 0;
      sku().consumed = sku().enabled; // le pool est plein entre-temps : le compte déjà membre ne doit pas être refusé à tort
      const retry = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ licence: { deja: true } });
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Validé');
    });

    it('entrée présente mais jamais Active : la trace donne l’état, l’absence d’erreur et l’origine groupe', async () => {
      h.ctx.graph.licenseForcedState = 'Disabled';
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ code: 'licence_en_cours', etape: 'licence_verification' });
      expect(members().has(id)).toBe(true);
      const expiree = h.ctx.events.find((e) => e.action === 'licence.verification_expiree');
      expect(expiree).toMatchObject({ lectures: 5, entree: true, entrees: 1, etat: 'Disabled', erreur: undefined, parGroupe: true });
      expect(JSON.stringify(h.ctx.events)).not.toMatch(/Martin|Anna|exemple\.test/);
    });

    it('reprise : un compte déjà licencié passe sans décompte, même avec 0 licence restante', async () => {
      const id = pending();
      h.ctx.graph.addLicensed(id, LICENSE_GROUP, LICENSE_SKU);
      sku().consumed = sku().enabled;
      h.ctx.graph.failOn.folder = 403;
      expect((await h.call('POST', `/api/demandes/${id}/valider`)).status).toBe(502);
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('Validé');
      expect(h.ctx.graph.calls.some((c) => c.path === '/subscribedSkus')).toBe(false);

      h.ctx.graph.failOn.folder = undefined;
      const retry = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ reprise: true, licence: { deja: true }, dossier: { cree: true } });
      expect(h.ctx.events.map((e) => e.action)).toContain('licence.deja_attribuee');
    });

    it('déjà membre du groupe, licence pas encore traitée : l’ajout répété (400) n’est pas une erreur', async () => {
      h.ctx.graph.licensePendingReads = 1;
      const id = pending();
      h.ctx.graph.groups.set(LICENSE_GROUP, new Set([id]));
      expect((await h.call('POST', `/api/demandes/${id}/valider`)).status).toBe(200);
    });

    it('SKU absent du tenant : 503, aucune écriture', async () => {
      h.ctx.graph.skus.clear();
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(503);
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
      expect(h.ctx.graph.calls.some((c) => c.method !== 'GET')).toBe(false);
    });

    it('échec Graph à l’ajout : 502 avec l’étape, statut inchangé', async () => {
      h.ctx.graph.failOn.groupAdd = 403;
      const id = pending();
      const res = await h.call('POST', `/api/demandes/${id}/valider`);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ etape: 'licence_ajout_groupe' });
      expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
    });

    it('503 avant toute lecture si la licence n’est pas configurée', async () => {
      const off = harness({ LICENSES: undefined, ENTRA_LICENSE_EXTENSION: undefined });
      await off.start();
      const id = off.ctx.graph.addPending(EXT, { givenName: 'Eva', surname: 'Test' });
      expect((await off.call('POST', `/api/demandes/${id}/valider`)).status).toBe(503);
      expect(off.ctx.graph.calls).toEqual([]);
      await off.stop();
    });
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
