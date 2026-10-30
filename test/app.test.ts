import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertReady, loadConfig } from '../src/config';
import { normalizePart, upnBase } from '../src/upn';
import { EXT, EXT_CREATOR, EXT_LIC, LICENSE_SKU, LICENSE_SKU_B, LICENSE_SKU_ZERO, RH_ID, principal, setup } from './helpers/ctx';

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

  const valid = () => ({ prenom: 'Éloïse', nom: 'De La Cruz', dateArrivee: '2026-11-03', poste: 'Comptable', service: 'Finance', managerId, typeContrat: 'Employé' });
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
      // Mêmes cas que web/src/lib/email.test.ts : la proposition du formulaire recopie cette règle.
      expect(normalizePart('D’Artagnan')).toBe('dartagnan');
      expect(normalizePart('Ærø Straße')).toBe('aerostrasse');
      expect(normalizePart('  --Anne--Marie--  ')).toBe('anne-marie');
      expect(normalizePart('日本')).toBe('');
      expect(upnBase('Jean-Pierre', 'De La Cruz')).toBe('jean-pierre.delacruz');
    });
  });

  describe('POST /api/demandes', () => {
    it('crée le compte désactivé avec statut et licence dans le même POST, puis le manager', async () => {
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
        usageLocation: 'FR',
        mailNickname: 'eloise.delacruz',
      });
      const pw = (created.passwordProfile as { password: string }).password;
      expect(pw).toHaveLength(32);

      const u = ctx.graph.users.get(out.id)!;
      expect(u.manager).toBe(`https://graph.microsoft.com/v1.0/users/${managerId}`);
      expect(u.props[EXT]).toBe('EnAttente');
      expect(u.props[EXT_LIC]).toBe(LICENSE_SKU);
      // Statut et licence font partie du POST : aucun état intermédiaire sans statut, aucun PATCH.
      expect(created).toMatchObject({ [EXT]: 'EnAttente', [EXT_LIC]: LICENSE_SKU, [EXT_CREATOR]: RH_ID });
      const writes = ctx.graph.calls.filter((c) => c.method !== 'GET').map((c) => c.method);
      expect(writes).toEqual(['POST', 'PUT']);

      // Traces : qui/quoi, sans nom, UPN, mot de passe ni identité de l'embauché.
      expect(ctx.events.map((e) => e.action)).toEqual(['demande.compte_cree', 'demande.manager_affecte']);
      expect(ctx.events.every((e) => e.actor === RH_ID)).toBe(true);
      const logged = JSON.stringify(ctx.events);
      for (const secret of [pw, 'eloise', 'Éloïse', 'cruz', 'exemple.test']) expect(logged.toLowerCase()).not.toContain(secret.toLowerCase());
    });

    it('Employé : type écrit dans employeeType, licence dérivée (Business Premium) dans l’extension, dans le même POST', async () => {
      const res = await post({ ...valid(), prenom: 'Emma', nom: 'Employee' });
      expect(res.status).toBe(201);
      const id = ((await res.json()) as { id: string }).id;
      expect(ctx.graph.users.get(id)!.props[EXT_LIC]).toBe(LICENSE_SKU);
      const created = ctx.graph.calls.filter((c) => c.method === 'POST' && c.path === '/users').at(-1)!.body as Record<string, unknown>;
      expect(created).toMatchObject({ employeeType: 'Employé', [EXT_LIC]: LICENSE_SKU });
      expect(ctx.events.find((e) => e.action === 'demande.compte_cree' && e.cible === id)).toMatchObject({ typeContrat: 'Employé', sku: LICENSE_SKU });
    });

    it('Contractor : la licence de son type (LICENCES_PAR_TYPE), pas celle d’Employé', async () => {
      const res = await post({ ...valid(), prenom: 'Béa', nom: 'Contractor', typeContrat: 'Contractor' });
      expect(res.status).toBe(201);
      const id = ((await res.json()) as { id: string }).id;
      expect(ctx.graph.users.get(id)!.props).toMatchObject({ employeeType: 'Contractor', [EXT_LIC]: LICENSE_SKU_B });
    });

    it('400 si le type est absent ou inconnu, sans aucune écriture', async () => {
      ctx.graph.calls.length = 0;
      const sansType: Record<string, unknown> = { ...valid() };
      delete sansType.typeContrat;
      for (const body of [sansType, { ...valid(), typeContrat: '' }, { ...valid(), typeContrat: 'employe' }, { ...valid(), typeContrat: 'Stagiaire' }, { ...valid(), typeContrat: 42 }]) {
        const res = await post(body);
        expect(res.status).toBe(400);
        expect(Object.keys(((await res.json()) as { details: object }).details)).toEqual(['typeContrat']);
      }
      expect(ctx.graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    });

    it('400 si la licence est envoyée (elle dépend du type), même valide, sans aucune écriture', async () => {
      ctx.graph.calls.length = 0;
      for (const licence of [LICENSE_SKU, LICENSE_SKU_B.toUpperCase(), '', 42, null]) {
        const res = await post({ ...valid(), licence });
        expect(res.status).toBe(400);
        expect(Object.keys(((await res.json()) as { details: object }).details)).toEqual(['licence']);
      }
      expect(ctx.graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    });

    it('409 si la licence du type n’a plus d’unité libre, sans aucune écriture', async () => {
      const sku = ctx.graph.skus.get(LICENSE_SKU_B)!;
      const avant = sku.consumed;
      sku.consumed = sku.enabled;
      try {
        ctx.graph.calls.length = 0;
        ctx.events.length = 0;
        const res = await post({ ...valid(), prenom: 'Zoé', nom: 'Zero', typeContrat: 'Contractor' });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Aucune licence disponible', code: 'licence_indisponible' });
        expect(ctx.graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
        expect(ctx.events.at(-1)).toMatchObject({ action: 'licence.indisponible', outcome: 'refuse', sku: LICENSE_SKU_B, typeContrat: 'Contractor', phase: 'demande' });
      } finally {
        sku.consumed = avant;
      }
    });

    it('409 si le type n’a pas de licence prévue (entrée absente de LICENCES_PAR_TYPE), sans aucune lecture ni écriture ; l’autre type passe', async () => {
      const partiel = setup({ LICENCES_PAR_TYPE: JSON.stringify({ Employé: LICENSE_SKU }) });
      const m = partiel.graph.addUser('chef@exemple.test', 'Camille Responsable');
      const s = partiel.app.listen(0);
      await new Promise((r) => s.once('listening', r));
      try {
        const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
        const envoyer = (typeContrat: string) =>
          fetch(`${url}/api/demandes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ms-client-principal': principal(['RH']) }, body: JSON.stringify({ ...valid(), managerId: m, typeContrat }) });
        partiel.graph.calls.length = 0;
        const refus = await envoyer('Contractor');
        expect(refus.status).toBe(409);
        expect(await refus.json()).toEqual({ error: 'Aucune licence disponible pour ce type de contrat', code: 'licence_indisponible' });
        expect(partiel.graph.calls).toEqual([]); // avant toute lecture Graph
        expect(partiel.events.at(-1)).toMatchObject({ action: 'licence.indisponible', outcome: 'refuse', typeContrat: 'Contractor', raison: 'non_prevue', phase: 'demande' });
        expect(JSON.stringify(partiel.events)).not.toMatch(/sku/);
        expect((await envoyer('Employé')).status).toBe(201);
      } finally {
        await new Promise((r) => s.close(r));
      }
    });

    it('409 pour les deux types quand LICENCES_PAR_TYPE est « {} » (aucun type configuré), et non 503', async () => {
      const vide = setup({ LICENCES_PAR_TYPE: '{}' });
      const s = vide.app.listen(0);
      await new Promise((r) => s.once('listening', r));
      try {
        const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
        for (const typeContrat of ['Employé', 'Contractor']) {
          const res = await fetch(`${url}/api/demandes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ms-client-principal': principal(['RH']) }, body: JSON.stringify({ ...valid(), typeContrat }) });
          expect(res.status).toBe(409);
          expect(((await res.json()) as { code: string }).code).toBe('licence_indisponible');
        }
        expect(vide.graph.calls).toEqual([]);
      } finally {
        await new Promise((r) => s.close(r));
      }
    });

    it('503 sans LICENCES_PAR_TYPE (déploiement en deux temps), sans aucune écriture ; le reste de l’API répond', async () => {
      const sans = setup({ LICENCES_PAR_TYPE: '' });
      const s = sans.app.listen(0);
      await new Promise((r) => s.once('listening', r));
      try {
        const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
        const res = await fetch(`${url}/api/demandes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ms-client-principal': principal(['RH']) }, body: JSON.stringify(valid()) });
        expect(res.status).toBe(503);
        expect(((await res.json()) as { error: string }).error).toContain('LICENCES_PAR_TYPE');
        expect(sans.graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
      } finally {
        await new Promise((r) => s.close(r));
      }
    });

    describe('adresse choisie (email)', () => {
      it('est utilisée telle quelle comme identifiant, en minuscules, sans suffixe', async () => {
        const res = await post({ ...valid(), prenom: 'Zoé', nom: 'Choix', email: ' Zoe.Choix-Perso@Exemple.Test ' });
        expect(res.status).toBe(201);
        const out = (await res.json()) as { id: string; userPrincipalName: string };
        expect(out.userPrincipalName).toBe('zoe.choix-perso@exemple.test');
        const created = ctx.graph.calls.filter((c) => c.method === 'POST' && c.path === '/users').at(-1)!.body as Record<string, unknown>;
        expect(created).toMatchObject({ userPrincipalName: 'zoe.choix-perso@exemple.test', mailNickname: 'zoe.choix-perso' });
      });

      it('409 email_pris si elle est déjà utilisée : une seule tentative, jamais de suffixe ajouté, aucune écriture, adresse absente des traces', async () => {
        ctx.graph.addUser('jean.pris@exemple.test');
        ctx.graph.calls.length = 0;
        ctx.events.length = 0;
        const res = await post({ ...valid(), prenom: 'Jean', nom: 'Pris', email: 'jean.pris@exemple.test' });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Cette adresse est déjà utilisée', code: 'email_pris' });
        expect(ctx.graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
        expect(ctx.events.at(-1)).toMatchObject({ action: 'demande.email_pris', outcome: 'refuse' });
        expect(JSON.stringify(ctx.events).toLowerCase()).not.toContain('jean');
      });

      it('409 email_pris aussi si elle est prise entre la vérification et la création', async () => {
        ctx.graph.addUser('luc.course@exemple.test');
        ctx.graph.hiddenOnce.add('luc.course@exemple.test');
        const res = await post({ ...valid(), prenom: 'Luc', nom: 'Course', email: 'luc.course@exemple.test' });
        expect(res.status).toBe(409);
        expect(((await res.json()) as { code: string }).code).toBe('email_pris');
      });

      it.each([
        ['mauvais domaine', 'zoe.choix@autre.test'],
        ['sans domaine', 'zoe.choix'],
        ['deux @', 'a@b@exemple.test'],
        ['accent', 'zoé.choix@exemple.test'],
        ['espace', 'zoe choix@exemple.test'],
        ['point double', 'zoe..choix@exemple.test'],
        ['point en tête', '.zoe@exemple.test'],
        ['tiret en fin', 'zoe-@exemple.test'],
        ['trop long', `${'a'.repeat(65)}@exemple.test`],
        ['pas du texte', 42],
      ])('400 sur email : %s', async (_nom, email) => {
        ctx.graph.calls.length = 0;
        const res = await post({ ...valid(), email });
        expect(res.status).toBe(400);
        expect(Object.keys(((await res.json()) as { details: object }).details)).toEqual(['email']);
        expect(ctx.graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
      });
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

    it('manager impossible à affecter : 201 avec avertissement, la demande reste EnAttente (pas de doublon)', async () => {
      ctx.graph.failOn.put = 403;
      ctx.events.length = 0;
      const res = await post({ ...valid(), prenom: 'Paul', nom: 'Panne' });
      ctx.graph.failOn.put = undefined;
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; statut: string; avertissement: string };
      expect(body).toMatchObject({ statut: 'EnAttente', avertissement: 'manager_non_affecte' });
      const u = ctx.graph.users.get(body.id)!;
      expect(u.accountEnabled).toBe(false);
      expect(u.props[EXT]).toBe('EnAttente');
      expect(u.manager).toBeUndefined();
      expect(ctx.events.at(-1)).toMatchObject({ action: 'demande.echec', etape: 'manager_affectation', cible: body.id, http: 403 });
    });

    it('échec de la création du compte : 502, aucun compte', async () => {
      ctx.graph.failOn.post = 403;
      const before = ctx.graph.users.size;
      const res = await post({ ...valid(), prenom: 'Nina', nom: 'Nulle' });
      ctx.graph.failOn.post = undefined;
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ etape: 'compte_creation' });
      expect(ctx.graph.users.size).toBe(before);
    });

    it('400 : champs manquants', async () => {
      const res = await post({});
      expect(res.status).toBe(400);
      const out = (await res.json()) as { details: Record<string, string> };
      expect(Object.keys(out.details).sort()).toEqual(['dateArrivee', 'managerId', 'nom', 'poste', 'prenom', 'service', 'typeContrat']);
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

  describe('GET /api/licences', () => {
    it('liste libellé et unités libres (jamais négatives), sans le groupe', async () => {
      const res = await fetch(`${base}/api/licences`, { headers: { 'x-ms-client-principal': principal(['RH']) } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        licences: [
          { skuId: LICENSE_SKU, libelle: 'Business Premium', disponibles: 4 },
          { skuId: LICENSE_SKU_B, libelle: 'Business Standard', disponibles: 3 },
          { skuId: LICENSE_SKU_ZERO, libelle: 'Business Basic', disponibles: 0 },
        ],
      });
      expect(ctx.graph.calls.filter((c) => c.path === '/subscribedSkus').length).toBeGreaterThan(0);
    });

    it('403 sans rôle RH', async () => {
      const res = await fetch(`${base}/api/licences`, { headers: { 'x-ms-client-principal': principal(['Autre']) } });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/annuaire/disponibilite', () => {
    const dispo = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/api/annuaire/disponibilite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ms-client-principal': principal(['RH']), ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });

    it('dit si l’adresse est libre ; l’adresse n’est ni dans l’URL, ni dans les traces, et rien n’est écrit', async () => {
      ctx.graph.addUser('marie.dispo@exemple.test');
      ctx.graph.calls.length = 0;
      ctx.events.length = 0;
      const prise = await dispo({ email: 'Marie.Dispo@exemple.test' });
      expect(prise.status).toBe(200);
      expect(await prise.json()).toEqual({ disponible: false });
      const libre = await dispo({ email: 'marie.libre@exemple.test' });
      expect(await libre.json()).toEqual({ disponible: true });
      expect(libre.headers.get('cache-control')).toBe('no-store');
      expect(ctx.graph.calls.every((c) => c.method === 'GET')).toBe(true);
      expect(ctx.events.map((e) => [e.action, e.outcome, e.disponible])).toEqual([['annuaire.disponibilite', 'ok', false], ['annuaire.disponibilite', 'ok', true]]);
      expect(JSON.stringify(ctx.events).toLowerCase()).not.toContain('marie');
    });

    it('400 : adresse invalide ou hors domaine, sans appel Graph', async () => {
      ctx.graph.calls.length = 0;
      for (const email of ['marie@autre.test', 'marie', '', 42, undefined]) {
        const res = await dispo(email === undefined ? {} : { email });
        expect(res.status).toBe(400);
        expect(Object.keys(((await res.json()) as { details: object }).details)).toEqual(['email']);
      }
      expect(ctx.graph.calls).toEqual([]);
    });

    it('502 si l’annuaire échoue (tracé sans l’adresse)', async () => {
      ctx.graph.failOn.upn = 403;
      ctx.events.length = 0;
      try {
        const res = await dispo({ email: 'marie.panne@exemple.test' });
        expect(res.status).toBe(502);
        expect(ctx.events.at(-1)).toMatchObject({ action: 'annuaire.disponibilite', outcome: 'erreur' });
      } finally {
        ctx.graph.failOn.upn = undefined;
      }
    });

    it('401 sans identité, 403 sans droit creer, 415 hors JSON', async () => {
      expect((await fetch(`${base}/api/annuaire/disponibilite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
      expect((await dispo({ email: 'a@exemple.test' }, { 'x-ms-client-principal': principal(['Autre']) })).status).toBe(403);
      expect((await dispo('email=a', { 'content-type': 'text/plain' })).status).toBe(415);
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
  it('laisse SharePoint non tranché, exige domaine et extension', () => {
    const c = loadConfig({});
    expect(c.sharePoint.siteId).toBeUndefined();
    expect(() => assertReady(c)).toThrow(/UPN_DOMAIN, ENTRA_STATUS_EXTENSION/);
    expect(() => loadConfig({ ENTRA_STATUS_EXTENSION: 'statutOnboarding' })).toThrow();
  });

  it('ne connaît plus de valideur désigné : DIRECTION_TYPE et DIRECTION_OBJECT_ID sont ignorés, même invalides (réglages d’avant)', () => {
    expect(() => loadConfig({ DIRECTION_TYPE: 'n-importe-quoi', DIRECTION_OBJECT_ID: 'pas-un-guid' })).not.toThrow();
    expect(loadConfig({ DIRECTION_TYPE: 'user', DIRECTION_OBJECT_ID: '3f972282-b072-4c41-9fd5-5bace4f6e059' })).not.toHaveProperty('direction');
  });

  it('valide LICENSES : JSON, GUID, libellé, doublons, extension associée', () => {
    const sku = 'eeeeeeee-0000-4000-8000-000000000005';
    const grp = 'dddddddd-0000-4000-8000-000000000004';
    const ext = 'extension_0123456789abcdef0123456789abcdef_licenceOnboarding';
    const ok = JSON.stringify([{ skuId: sku.toUpperCase(), libelle: ' Premium ', groupId: grp }]);
    expect(loadConfig({ LICENSES: ok, ENTRA_LICENSE_EXTENSION: ext }).licenses).toEqual([{ skuId: sku, libelle: 'Premium', groupId: grp }]);
    expect(loadConfig({}).licenses).toEqual([]);
    for (const bad of ['pas du json', '[]', '{}', JSON.stringify([{ skuId: 'x', libelle: 'a', groupId: grp }]), JSON.stringify([{ skuId: sku, libelle: '', groupId: grp }]), JSON.stringify([{ skuId: sku, libelle: 'a', groupId: 'x' }]),
      JSON.stringify([{ skuId: sku, libelle: 'a', groupId: grp }, { skuId: sku, libelle: 'b', groupId: 'dddddddd-0000-4000-8000-000000000009' }]),
      JSON.stringify([{ skuId: sku, libelle: 'a', groupId: grp }, { skuId: 'eeeeeeee-0000-4000-8000-000000000009', libelle: 'b', groupId: grp }])]) {
      expect(() => loadConfig({ LICENSES: bad, ENTRA_LICENSE_EXTENSION: ext })).toThrow();
    }
    expect(() => loadConfig({ LICENSES: ok })).toThrow(/ENTRA_LICENSE_EXTENSION/);
  });

  it('valide LICENCES_PAR_TYPE : objet JSON, chaque type facultatif, des SKU de LICENSES ; absent : pas d’erreur (503 à la création)', () => {
    const [a, b] = ['eeeeeeee-0000-4000-8000-000000000005', 'eeeeeeee-0000-4000-8000-0000000000b5'];
    const grp = 'dddddddd-0000-4000-8000-000000000004';
    const ext = 'extension_0123456789abcdef0123456789abcdef_licenceOnboarding';
    const licenses = JSON.stringify([{ skuId: a, libelle: 'Premium', groupId: grp }, { skuId: b, libelle: 'Basic', groupId: 'dddddddd-0000-4000-8000-0000000000b4' }]);
    const base = { LICENSES: licenses, ENTRA_LICENSE_EXTENSION: ext };
    expect(loadConfig(base).licenseByType).toBeUndefined();
    expect(loadConfig({ ...base, LICENCES_PAR_TYPE: JSON.stringify({ Employé: a.toUpperCase(), Contractor: b }) }).licenseByType).toEqual({ Employé: a, Contractor: b });
    // Chaque type est facultatif : absent ou null = pas de licence prévue (409 à la création), pas une erreur de configuration.
    expect(loadConfig({ ...base, LICENCES_PAR_TYPE: JSON.stringify({ Employé: a }) }).licenseByType).toEqual({ Employé: a });
    expect(loadConfig({ ...base, LICENCES_PAR_TYPE: JSON.stringify({ Employé: a, Contractor: null }) }).licenseByType).toEqual({ Employé: a });
    expect(loadConfig({ ...base, LICENCES_PAR_TYPE: '{}' }).licenseByType).toEqual({});
    for (const bad of [
      'pas du json', '[]', '"texte"', 'null', '42',
      JSON.stringify({ Employé: '' }),
      JSON.stringify({ Employé: 7 }),
      JSON.stringify({ Employé: a, Contractor: 'x' }),
      JSON.stringify({ Employé: a, Contractor: 'eeeeeeee-0000-4000-8000-000000000009' }), // SKU hors LICENSES
      JSON.stringify({ Employé: a, Contractor: b, Stagiaire: a }),
    ]) {
      expect(() => loadConfig({ ...base, LICENCES_PAR_TYPE: bad })).toThrow(/LICENCES_PAR_TYPE/);
    }
    expect(() => loadConfig({ LICENCES_PAR_TYPE: JSON.stringify({ Employé: a, Contractor: b }) })).toThrow(/LICENCES_PAR_TYPE/); // sans LICENSES
  });

  it('ignore le contournement d’auth de dev en production', () => {
    expect(loadConfig({ ALLOW_INSECURE_DEV_AUTH: 'true' }).trustAuthHeaders).toBe(true);
    expect(loadConfig({ ALLOW_INSECURE_DEV_AUTH: 'true', NODE_ENV: 'production' }).trustAuthHeaders).toBe(false);
  });
});
