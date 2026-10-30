import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { todayIn } from '../src/dates';
import { loadConfig } from '../src/config';
import { sanitizeGraphMessage } from '../src/directory';
import { temporaryPassword } from '../src/password';
import { recordTokenInfo } from '../src/tokenRoles';
import { ARRIVANTS_GROUP, DIR_ID, EXT, EXT_ACT, NOW } from './helpers/ctx';
import { harness } from './helpers/harness';

// NOW (ctx) = 2026-10-27 10:00 UTC, soit le 27 octobre à Paris.
const TODAY = '2026-10-27';
/** Format du mot de passe temporaire : quatre groupes de quatre, sans caractères ambigus. */
const MDP_RE = /^([A-HJ-NP-Z][a-km-z][2-9][a-km-z]-){3}[A-HJ-NP-Z][a-km-z][2-9][a-km-z]$/;

/** Contexte commun : un compte d'onboarding par statut, et les lectures de Graph qui en découlent. */
function suite(env: Record<string, string | undefined> = {}) {
  const h = harness(env);
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());
  const g = () => h.ctx.graph;
  const account = (statut = 'Validé', hireDate = TODAY, enabled = false) =>
    g().addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut, hireDate, enabled });
  /** Compte Actif, dans le groupe des arrivants ; `extras` pose les dates et l'état d'onboarding. */
  const actif = (extras: Record<string, unknown> = {}, o: { membre?: boolean; authenticator?: boolean } = {}) => {
    const id = g().addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut: 'Actif', hireDate: '2026-10-26', enabled: true, extras });
    if (o.membre !== false) g().groups.set(ARRIVANTS_GROUP, (g().groups.get(ARRIVANTS_GROUP) ?? new Set()).add(id));
    if (o.authenticator) g().authenticators.add(id);
    return id;
  };
  // checkMemberGroups est un POST de lecture (appartenance à un groupe) : ce n'est pas une écriture.
  const writes = () =>
    g()
      .calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/checkMemberGroups'))
      .map((c) => `${c.method} ${c.path.replace(/^\/users\/[^/]+/, '')}`);
  return { h, g, account, actif, writes };
}

describe('POST /api/demandes/:id/activer', () => {
  const { h, g, account, writes } = suite();
  const activer = (id: string) => h.callRh('POST', `/api/demandes/${id}/activer`);

  it('active le compte, rejoue le groupe des arrivants, date la remise, pose un mot de passe temporaire à changer, puis Actif', async () => {
    const id = account();
    const res = await activer(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');

    const out = (await res.json()) as Record<string, unknown>;
    expect(out).toEqual({ id, statut: 'Actif', regeneration: false, motDePasseTemporaire: expect.stringMatching(MDP_RE) });
    // Le mot de passe affiché est celui posé dans Entra, avec changement imposé à la première connexion.
    expect(g().passwords.get(id)).toEqual([{ password: out.motDePasseTemporaire, forceChangePasswordNextSignIn: true }]);

    const u = g().users.get(id)!;
    expect(u.accountEnabled).toBe(true);
    expect(u.props[EXT]).toBe('Actif');
    expect(u.props[EXT_ACT]).toBe(NOW.toISOString());
    expect(g().groups.get(ARRIVANTS_GROUP)?.has(id)).toBe(true);
    // Compte, groupe, date de remise AVANT le mot de passe (référence de « changé par l'arrivant »), statut en dernier.
    expect(writes()).toEqual(['PATCH ', `POST /groups/${ARRIVANTS_GROUP}/members/$ref`, 'PATCH ', 'PATCH ', 'PATCH ']);
    const patches = g().calls.filter((c) => c.method === 'PATCH').map((c) => Object.keys(c.body as object)[0]);
    expect(patches).toEqual(['accountEnabled', EXT_ACT, 'passwordProfile', EXT]);
  });

  it('ne trace jamais le mot de passe (ni nom, ni UPN)', async () => {
    const id = account();
    const out = (await (await activer(id)).json()) as { motDePasseTemporaire: string };
    const logged = JSON.stringify(h.ctx.events);
    expect(logged).not.toContain(out.motDePasseTemporaire);
    expect(logged).not.toContain('Martin');
    expect(logged).not.toContain('exemple.test');
    expect(h.ctx.events.map((e) => e.action)).toEqual(['demande.compte_active', 'demande.arrivants_ajout', 'demande.mdp_temporaire', 'demande.activee']);
  });

  it('409 avant la date d’arrivée : rien n’est écrit, en-têtes no-store présents', async () => {
    const id = account('Validé', '2026-10-28');
    const res = await activer(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Activation impossible', raison: 'date_arrivee_future' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(writes()).toEqual([]);
    expect(g().users.get(id)!.accountEnabled).toBe(false);
  });

  it('accepte une date d’arrivée passée', async () => {
    expect((await activer(account('Validé', '2026-10-01'))).status).toBe(200);
  });

  it('409 si le statut n’est pas Validé : EnAttente, Refusé, hors onboarding, Actif (nouveau mot de passe) et Terminé', async () => {
    for (const statut of ['EnAttente', 'Refusé']) expect((await activer(account(statut))).status).toBe(409);
    const autre = g().addUser('autre@exemple.test', 'Autre');
    expect((await activer(autre)).status).toBe(409);
    const actifRes = await activer(account('Actif', TODAY, true));
    expect(actifRes.status).toBe(409);
    expect(await actifRes.json()).toMatchObject({ raison: 'deja_actif' });
    const fini = await activer(account('Terminé', TODAY, true));
    expect(fini.status).toBe(409);
    expect(await fini.json()).toMatchObject({ raison: 'onboarding_termine' });
    expect(writes()).toEqual([]);
    expect(g().passwords.size).toBe(0);
  });

  it('401 sans identité, 403 avec un rôle étranger (RH et Direction activent)', async () => {
    const id = account();
    expect((await fetch(`${h.base}/api/demandes/${id}/activer`, { method: 'POST' })).status).toBe(401);
    expect((await h.callAs(['Autre'], DIR_ID, 'POST', `/api/demandes/${id}/activer`)).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it('échec du mot de passe : 502 avec l’étape, sans mot de passe, compte resté Validé ; un nouvel « Activer » aboutit', async () => {
    const id = account();
    g().failOn.passwordPatch = 403;
    const res = await activer(id);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'mot_de_passe', statut: 'Validé' });
    expect(g().users.get(id)!.props[EXT]).toBe('Validé');
    expect(h.ctx.events.find((e) => e.action === 'demande.echec')).toMatchObject({ etape: 'mot_de_passe', http: 403, cible: id });

    g().failOn.passwordPatch = undefined;
    const retry = await activer(id);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ statut: 'Actif', motDePasseTemporaire: expect.stringMatching(MDP_RE) });
  });

  it('échec du statut après le mot de passe : 502 sans mot de passe dans la réponse ; un nouvel « Activer » en pose un autre', async () => {
    const id = account();
    g().failOn.statusPatch = 500;
    const res = await activer(id);
    expect(res.status).toBe(502);
    const text = await res.text();
    const premier = g().passwords.get(id)![0]!.password;
    expect(text).not.toContain(premier);
    expect(JSON.parse(text)).toMatchObject({ etape: 'statut', statut: 'Validé' });
    expect(JSON.stringify(h.ctx.events)).not.toContain(premier);

    g().failOn.statusPatch = undefined;
    const retry = await activer(id);
    expect(retry.status).toBe(200);
    const out = (await retry.json()) as { motDePasseTemporaire: string };
    expect(out.motDePasseTemporaire).not.toBe(premier);
    expect(g().passwords.get(id)!.at(-1)!.password).toBe(out.motDePasseTemporaire);
    expect(g().users.get(id)!.props[EXT]).toBe('Actif');
  });

  it('échec Graph : demande.echec trace http, code et message assaini (ni nom ni UPN), absent de la réponse', async () => {
    const id = account();
    g().failOn.passwordPatch = 400;
    const res = await activer(id);
    expect(res.status).toBe(502);
    expect(JSON.stringify(h.ctx.events)).not.toMatch(/Anna|Martin|example\.test/);
  });

  it('403 Graph : demande.echec ajoute les rôles (noms) du dernier jeton ; pas pour un 400', async () => {
    recordTokenInfo({ roles: ['User.Read.All', 'User.ReadWrite.All'], issuedAt: '2026-10-28T19:05:10.000Z' });
    try {
      const id = account();
      g().failOn.passwordPatch = 403;
      await activer(id);
      const echec403 = h.ctx.events.find((e) => e.action === 'demande.echec' && e.etape === 'mot_de_passe');
      expect(echec403).toMatchObject({ http: 403, jetonRoles: 'User.Read.All,User.ReadWrite.All', jetonNbRoles: 2, jetonEmisA: '2026-10-28T19:05:10.000Z' });

      h.ctx.events.length = 0;
      g().failOn.passwordPatch = 400;
      await activer(id);
      const echec400 = h.ctx.events.find((e) => e.action === 'demande.echec' && e.etape === 'mot_de_passe');
      expect(echec400).toMatchObject({ http: 400 });
      expect(echec400).not.toHaveProperty('jetonRoles');
    } finally {
      recordTokenInfo(undefined);
    }
  });

  it('sanitizeGraphMessage : masque emails et valeurs entre guillemets, borne la longueur, ignore le vide', () => {
    expect(sanitizeGraphMessage(undefined)).toBeUndefined();
    expect(sanitizeGraphMessage('  ')).toBeUndefined();
    expect(sanitizeGraphMessage('Property userPrincipalName "jean.dupont@telesio.fr" already exists')).toBe(
      'Property userPrincipalName [valeur] already exists',
    );
    expect(sanitizeGraphMessage('conflit jean.dupont@telesio.fr ici')).toBe('conflit [email] ici');
    expect(sanitizeGraphMessage('x'.repeat(1000))).toHaveLength(300);
  });
});

describe('temporaryPassword', () => {
  it('quatre groupes lisibles, complexité Entra (majuscule, minuscule, chiffre, symbole), jamais deux fois le même', () => {
    const vus = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = temporaryPassword();
      expect(p).toMatch(MDP_RE);
      expect(p).not.toMatch(/[0O1lI]/);
      vus.add(p);
    }
    expect(vus.size).toBe(200);
  });
});

describe('POST /api/demandes/:id/regenerer', () => {
  const { h, g, account, actif, writes } = suite();
  const regenerer = (id: string, body: unknown = { motif: 'code_perdu' }) => h.callRh('POST', `/api/demandes/${id}/regenerer`, body);

  it('nouveau mot de passe temporaire, date de remise mise à jour, motif tracé (jamais le mot de passe)', async () => {
    const id = actif({ [EXT_ACT]: '2026-10-26T10:00:00.000Z' });
    const res = await regenerer(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const out = (await res.json()) as { motDePasseTemporaire: string };
    expect(out).toEqual({ id, statut: 'Actif', regeneration: true, motDePasseTemporaire: expect.stringMatching(MDP_RE) });
    expect(g().passwords.get(id)).toEqual([{ password: out.motDePasseTemporaire, forceChangePasswordNextSignIn: true }]);
    // La référence de « mot de passe changé par l'arrivant » repart de cette remise.
    expect(g().users.get(id)!.props[EXT_ACT]).toBe(NOW.toISOString());
    expect(writes()).toEqual([`POST /groups/${ARRIVANTS_GROUP}/members/$ref`, 'PATCH ', 'PATCH ']);
    expect(h.ctx.events.map((e) => e.action)).toEqual(['demande.mdp_temporaire', 'demande.mdp_regenere']);
    expect(h.ctx.events.at(-1)).toMatchObject({ cible: id, motif: 'code_perdu' });
    const logged = JSON.stringify(h.ctx.events);
    for (const secret of [out.motDePasseTemporaire, 'Martin', 'exemple.test']) expect(logged).not.toContain(secret);
  });

  it('400 sans motif, hors de la liste ou en texte libre : rien n’est écrit ni tracé', async () => {
    const id = actif();
    for (const body of [{}, { motif: 'inconnu' }, { motif: 'tap_expire' }, { motif: 'Anna Martin a perdu son code' }, { motif: 42 }]) {
      const res = await regenerer(id, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'Entrée invalide', details: { motif: expect.stringContaining('code_perdu') } });
    }
    expect(writes()).toEqual([]);
    expect(JSON.stringify(h.ctx.events)).not.toContain('Anna');
  });

  it('409 une fois l’onboarding Terminé, ou hors Actif (un compte Validé passe par « Activer »)', async () => {
    const fini = account('Terminé', TODAY, true);
    const res = await regenerer(fini);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ raison: 'onboarding_termine' });
    for (const id of [account('EnAttente'), account('Validé', TODAY, false), account('Validé', TODAY, true)]) {
      const r = await regenerer(id);
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ raison: 'statut' });
    }
    expect(writes()).toEqual([]);
  });

  it('403 avec un rôle étranger', async () => {
    const id = actif();
    expect((await h.callAs(['Autre'], DIR_ID, 'POST', `/api/demandes/${id}/regenerer`, { motif: 'code_perdu' })).status).toBe(403);
    expect(writes()).toEqual([]);
  });
});

describe('GET /api/activations', () => {
  const { h, g, account, actif, writes } = suite();

  it('liste les Validé (activer ou attendre) et tous les Actif avec l’état de l’onboarding, réservé RH', async () => {
    account('Validé', TODAY);
    g().addPending(EXT, { givenName: 'Plus', surname: 'Tard', statut: 'Validé', hireDate: '2026-11-15' });
    // Mot de passe changé après l'activation, Authenticator absent : non terminé.
    actif({ [EXT_ACT]: '2026-10-26T10:00:00Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' });
    // Très ancien : toujours listé tant que l'onboarding n'est pas Terminé.
    g().addPending(EXT, { givenName: 'Ancien', surname: 'Actif', statut: 'Actif', hireDate: '2026-06-01', enabled: true, extras: { [EXT_ACT]: '2026-06-01T10:00:00Z', lastPasswordChangeDateTime: '2026-05-01T10:00:00Z' } });
    g().addPending(EXT, { givenName: 'En', surname: 'Attente', statut: 'EnAttente' });
    g().addPending(EXT, { givenName: 'Fini', surname: 'Terminé', statut: 'Terminé', enabled: true });

    const res = await h.callRh('GET', '/api/activations');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const out = (await res.json()) as { demandes: { nom: string; action: string; statut: string; onboarding?: unknown }[] };
    // L'adresse n'est renvoyée que par le suivi : cette liste garde sa forme.
    expect(JSON.stringify(out)).not.toMatch(/upn|exemple\.test/);
    expect(out.demandes.map((d) => [d.nom, d.statut, d.action, d.onboarding])).toEqual([
      ['Anna Martin', 'Validé', 'activer', undefined],
      ['Plus Tard', 'Validé', 'attendre', undefined],
      ['Anna Martin', 'Actif', 'regenerer', { motDePasse: true, authenticator: false, termine: false }],
      ['Ancien Actif', 'Actif', 'regenerer', { motDePasse: false, authenticator: false, termine: false }],
    ]);
    expect((await h.callAs(['Autre'], DIR_ID, 'GET', '/api/activations')).status).toBe(403);
  });

  it('lecture seule : aucune écriture Graph, même quand l’onboarding est complet (la finalisation est un POST)', async () => {
    actif({ [EXT_ACT]: '2026-10-26T10:00:00Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' }, { authenticator: true });
    const out = (await (await h.callRh('GET', '/api/activations')).json()) as { demandes: { onboarding: unknown }[] };
    expect(out.demandes[0]!.onboarding).toEqual({ motDePasse: true, authenticator: true, termine: true });
    expect(writes()).toEqual([]);
    expect(h.ctx.events.map((e) => e.action)).toEqual(['activation.liste']);
  });

  it('un échec de lecture pour un compte ne fait pas échouer la liste', async () => {
    actif({ [EXT_ACT]: '2026-10-26T10:00:00Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' });
    account('Validé', TODAY);
    g().failOn.authenticator = 403;
    const res = await h.callRh('GET', '/api/activations');
    expect(res.status).toBe(200);
    const out = (await res.json()) as { demandes: { statut: string; onboarding?: unknown }[] };
    expect(out.demandes.map((d) => [d.statut, d.onboarding])).toEqual([['Validé', undefined], ['Actif', { verification: 'echec' }]]);
    expect(h.ctx.events.some((e) => e.action === 'demande.echec' && e.etape === 'onboarding_authenticator')).toBe(true);
  });

  it('ne filtre côté Graph que sur le statut : statut + date + $expand est refusé (400 Request_UnsupportedQuery)', async () => {
    g().addPending(EXT, { givenName: 'Recent', surname: 'Actif', statut: 'Actif', hireDate: '2026-10-25', enabled: true });
    g().addPending(EXT, { givenName: 'Ancien', surname: 'Actif', statut: 'Actif', hireDate: '2026-06-01', enabled: true });

    const res = await h.callRh('GET', '/api/activations');
    expect(res.status).toBe(200);
    const out = (await res.json()) as { demandes: { nom: string }[] };
    expect(out.demandes.map((d) => d.nom)).toEqual(['Recent Actif', 'Ancien Actif']);

    const lists = g().calls.filter((c) => c.method === 'GET' && c.path === '/users');
    expect(lists.length).toBeGreaterThan(0);
    for (const c of lists) {
      expect(c.filter).toMatch(/^extension_\w+ eq '[^']+'$/);
      expect(c.filter).not.toContain('employeeHireDate');
      expect(c.headers.ConsistencyLevel).toBe('eventual');
    }
  });

  it('suit les pages Graph : aucun compte n’est manqué', async () => {
    g().pageSize = 2;
    for (let i = 0; i < 5; i++) g().addPending(EXT, { givenName: `Vieux${i}`, surname: 'Actif', statut: 'Actif', hireDate: '2026-01-01', enabled: true });
    g().addPending(EXT, { givenName: 'Recent', surname: 'Actif', statut: 'Actif', hireDate: '2026-10-26', enabled: true });
    for (let i = 0; i < 3; i++) g().addPending(EXT, { givenName: `Valide${i}`, surname: 'Test', statut: 'Validé', hireDate: TODAY });

    const out = (await (await h.callRh('GET', '/api/activations')).json()) as { demandes: { nom: string; statut: string }[]; tronque: boolean };
    expect(out.tronque).toBe(false);
    expect(out.demandes).toHaveLength(9);
  });

  it('plafonne le nombre de pages et signale tronque', async () => {
    g().pageSize = 1;
    for (let i = 0; i < 12; i++) g().addPending(EXT, { givenName: `V${i}`, surname: 'Test', statut: 'Validé', hireDate: TODAY });

    const out = (await (await h.callRh('GET', '/api/activations')).json()) as { demandes: unknown[]; tronque: boolean };
    expect(out.tronque).toBe(true);
    expect(out.demandes).toHaveLength(10);
  });
});

describe('POST /api/demandes/:id/terminer', () => {
  const { h, g, account, actif, writes } = suite();
  const terminer = (id: string) => h.callRh('POST', `/api/demandes/${id}/terminer`);
  /** Activation à 10:00:00.000Z ; mot de passe changé `apres` (ISO) ; Authenticator si demandé. */
  const complet = (apres = '2026-10-26T12:00:00Z', authenticator = true, extras: Record<string, unknown> = {}) =>
    actif({ [EXT_ACT]: '2026-10-26T10:00:00.000Z', lastPasswordChangeDateTime: apres, ...extras }, { authenticator });

  it('mot de passe changé par l’arrivant après la remise ET Authenticator : retrait des arrivants, puis Terminé en dernier', async () => {
    const id = complet();
    const res = await terminer(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, statut: 'Terminé', deja: false });
    expect(writes()).toEqual([`DELETE /groups/${ARRIVANTS_GROUP}/members/${id}/$ref`, 'PATCH ']);
    expect(g().users.get(id)!.props[EXT]).toBe('Terminé');
    expect(g().groups.get(ARRIVANTS_GROUP)?.has(id)).toBe(false);
    expect(h.ctx.events.map((e) => e.action)).toEqual(['onboarding.arrivants_retrait', 'onboarding.termine']);
    const logged = JSON.stringify(h.ctx.events);
    for (const pii of ['Martin', 'Anna', 'exemple.test']) expect(logged).not.toContain(pii);
  });

  it('mot de passe inchangé depuis la remise (avant, à la même seconde, ou dans la marge : c’est la remise elle-même) : pas de transition', async () => {
    for (const quand of ['2026-10-25T09:00:00Z', '2026-10-26T10:00:00Z', '2026-10-26T10:00:30Z']) {
      const id = complet(quand);
      const res = await terminer(id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Activation impossible', raison: 'onboarding_non_termine', motDePasse: false, authenticator: true });
      expect(g().users.get(id)!.props[EXT]).toBe('Actif');
    }
    expect(writes()).toEqual([]);
  });

  it('compare des instants, pas des chaînes : remise à 10:00:00.000Z + marge de 60 s, 10:01:00Z ne compte pas, 10:01:01Z compte', async () => {
    const egal = await terminer(complet('2026-10-26T10:01:00Z'));
    expect(egal.status).toBe(409);
    expect((await terminer(complet('2026-10-26T10:01:01Z'))).status).toBe(200);
  });

  it('sans méthode Microsoft Authenticator : pas de transition', async () => {
    const id = complet('2026-10-26T12:00:00Z', false);
    const res = await terminer(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ raison: 'onboarding_non_termine', motDePasse: true, authenticator: false });
    expect(writes()).toEqual([]);
    expect(g().users.get(id)!.props[EXT]).toBe('Actif');
  });

  it('compte activé avant l’extension d’activation : repli sur la date de création du compte', async () => {
    const avant = actif({ createdDateTime: '2026-10-20T08:00:00Z', lastPasswordChangeDateTime: '2026-10-20T08:00:00Z' }, { authenticator: true });
    expect((await terminer(avant)).status).toBe(409);
    const apres = actif({ createdDateTime: '2026-10-20T08:00:00Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' }, { authenticator: true });
    expect((await terminer(apres)).status).toBe(200);
  });

  it('reprise après une finalisation partielle : le groupe déjà quitté ne fait pas échouer la suite', async () => {
    const id = complet();
    g().failOn.statusPatch = 500;
    const res = await terminer(id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'statut', statut: 'Actif' });
    expect(g().groups.get(ARRIVANTS_GROUP)?.has(id)).toBe(false);
    expect(g().users.get(id)!.props[EXT]).toBe('Actif');

    g().failOn.statusPatch = undefined;
    g().calls.length = 0;
    const retry = await terminer(id);
    expect(retry.status).toBe(200);
    // Plus membre du groupe : seul le statut est écrit (retirer un non-membre échouerait en 400).
    expect(writes()).toEqual(['PATCH ']);
    expect(g().users.get(id)!.props[EXT]).toBe('Terminé');
  });

  it('déjà Terminé : 200 sans écriture ; hors Actif : 409 ; rôle étranger : 403', async () => {
    const fini = account('Terminé', TODAY, true);
    const res = await terminer(fini);
    expect(await res.json()).toEqual({ id: fini, statut: 'Terminé', deja: true });
    expect(writes()).toEqual([]);
    expect((await terminer(account('Validé'))).status).toBe(409);
    expect((await h.callAs(['Autre'], DIR_ID, 'POST', `/api/demandes/${complet()}/terminer`)).status).toBe(403);
  });
});

describe('Activation non configurée', () => {
  for (const [nom, env] of [
    ['ARRIVANTS_GROUP_ID', { ARRIVANTS_GROUP_ID: undefined }],
    ['ENTRA_ACTIVATION_EXTENSION', { ENTRA_ACTIVATION_EXTENSION: undefined }],
  ] as const) {
    describe(`sans ${nom}`, () => {
      const { h, g, account } = suite(env);
      it('toutes les routes d’activation répondent 503 sans rien écrire', async () => {
        const id = account();
        expect((await h.callRh('GET', '/api/activations')).status).toBe(503);
        expect((await h.callRh('POST', `/api/demandes/${id}/activer`)).status).toBe(503);
        expect((await h.callRh('POST', `/api/demandes/${id}/regenerer`, { motif: 'autre' })).status).toBe(503);
        expect((await h.callRh('POST', `/api/demandes/${id}/terminer`)).status).toBe(503);
        expect(g().calls.some((c) => c.method !== 'GET')).toBe(false);
      });
    });
  }
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

  it('/activation : script valide, mot de passe temporaire, nouveau mot de passe avec motif, finalisation par POST, plus de TAP', async () => {
    const html = await (await fetch(`${h.base}/activation`)).text();
    const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('Mot de passe temporaire pour ');
    expect(script).toContain('Nouveau mot de passe');
    expect(script).toContain("'/regenerer'");
    expect(script).toContain("'/terminer'");
    expect(script).toContain('Onboarding non terminé');
    expect(script).not.toContain('TAP');
    expect(html).toContain('<th>Onboarding</th>');
  });

  it('/direction : le 202 « licence en cours » s’affiche en avertissement, le script reste valide', async () => {
    const html = await (await fetch(`${h.base}/direction`)).text();
    const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("r.status === 202 && r.data && r.data.code === 'licence_en_cours'");
    expect(script).toContain("'warn'");
    expect(html).toContain('.msg.warn{');
  });
});

describe('fuseau et config', () => {
  it('valide ARRIVANTS_GROUP_ID (GUID, minuscules) et ENTRA_ACTIVATION_EXTENSION', () => {
    expect(loadConfig({}).arrivantsGroupId).toBeUndefined();
    expect(loadConfig({ ARRIVANTS_GROUP_ID: ARRIVANTS_GROUP.toUpperCase() }).arrivantsGroupId).toBe(ARRIVANTS_GROUP);
    expect(() => loadConfig({ ARRIVANTS_GROUP_ID: 'pas-un-guid' })).toThrow(/ARRIVANTS_GROUP_ID/);
    expect(() => loadConfig({ ENTRA_ACTIVATION_EXTENSION: 'activationOnboarding' })).toThrow(/ENTRA_ACTIVATION_EXTENSION/);
    expect(loadConfig({ ENTRA_ACTIVATION_EXTENSION: EXT_ACT }).activationExtension).toBe(EXT_ACT);
  });

  it('le jour J se calcule dans le fuseau métier, pas en UTC', () => {
    const lateUtc = new Date('2026-10-26T23:30:00Z'); // 00:30 le 27 à Paris
    expect(todayIn('Europe/Paris', lateUtc)).toBe('2026-10-27');
    expect(todayIn('UTC', lateUtc)).toBe('2026-10-26');
  });

  it('valide TZ_METIER (défaut Europe/Paris) ; les anciens réglages du TAP sont ignorés', () => {
    expect(loadConfig({}).timeZone).toBe('Europe/Paris');
    expect(() => loadConfig({ TZ_METIER: 'Mars/Olympus' })).toThrow();
    expect(() => loadConfig({ TAP_LIFETIME_MINUTES: 'abc', TAP_START_DELAY_MINUTES: 'abc' })).not.toThrow();
  });
});
