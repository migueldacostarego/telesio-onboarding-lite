import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { ACTEUR_SYSTEME, decoderEvenement, encoderEvenement } from '../src/history';
import { ARRIVANTS_GROUP, DIR_ID, EXT, EXT_ACT, EXT_CREATOR, EXT_LIC, HISTORY, HISTORY_ENV, LICENSE_GROUP, LICENSE_SKU, NOW, RH_ID } from './helpers/ctx';
import { harness } from './helpers/harness';

const ENV_BASE = { UPN_DOMAIN: 'exemple.test', ENTRA_STATUS_EXTENSION: EXT };

describe('historique : configuration et format', () => {
  it('les quatre extensions ou aucune', () => {
    expect(loadConfig(ENV_BASE).history).toBeUndefined();
    expect(loadConfig({ ...ENV_BASE, ...HISTORY_ENV }).history).toEqual(HISTORY);
    expect(() => loadConfig({ ...ENV_BASE, ENTRA_HISTORY_VALIDATION_EXTENSION: HISTORY.validation })).toThrow(/ENTRA_HISTORY_ACTIVATION_EXTENSION/);
    expect(() => loadConfig({ ...ENV_BASE, ...HISTORY_ENV, ENTRA_HISTORY_TERMINE_EXTENSION: 'termine' })).toThrow(/ENTRA_HISTORY_TERMINE_EXTENSION invalide/);
  });

  it('encode objectId et date ISO ; tout autre acteur devient « systeme » ; une valeur illisible n’est pas une erreur', () => {
    const quand = new Date('2026-10-27T10:00:00.000Z');
    expect(encoderEvenement(DIR_ID.toUpperCase(), quand)).toBe(`${DIR_ID}|2026-10-27T10:00:00.000Z`);
    expect(encoderEvenement('systeme:terminaison', quand)).toBe(`${ACTEUR_SYSTEME}|2026-10-27T10:00:00.000Z`);
    expect(encoderEvenement(DIR_ID, quand, 3)).toBe(`${DIR_ID}|2026-10-27T10:00:00.000Z|3`);
    expect(decoderEvenement(`${DIR_ID}|2026-10-27T10:00:00.000Z|3`)).toEqual({ par: DIR_ID, le: '2026-10-27T10:00:00.000Z', nombre: 3 });
    for (const brut of [null, undefined, '', 'x', `${DIR_ID}|pas-une-date`, '|2026-10-27T10:00:00Z', 'quelquun|2026-10-27T10:00:00Z']) expect(decoderEvenement(brut)).toBeNull();
    // Le plus long format tient largement dans les 256 caractères d'une extension Entra.
    expect(encoderEvenement(DIR_ID, quand, 999).length).toBeLessThan(80);
  });
});

function suite(env: Record<string, string | undefined> = HISTORY_ENV) {
  const h = harness(env);
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());
  const g = () => h.ctx.graph;
  const compte = (statut: string, extras: Record<string, unknown> = {}, o: { managerId?: string; hireDate?: string; authenticator?: boolean } = {}) => {
    const id = g().addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut, hireDate: o.hireDate ?? '2026-10-20', enabled: statut === 'Actif' || statut === 'Terminé', managerId: o.managerId, extras: { createdDateTime: '2026-10-01T08:00:00Z', ...extras } });
    if (o.authenticator) g().authenticators.add(id);
    return id;
  };
  const props = (id: string) => g().users.get(id)!.props;
  const patches = () => g().calls.filter((c) => c.method === 'PATCH');
  return { h, g, compte, props, patches };
}

describe('historique écrit avec les statuts', () => {
  const { h, g, compte, props, patches } = suite();

  it('valider : statut et auteur dans le même PATCH, une reprise ne l’écrase pas', async () => {
    const id = compte('EnAttente', { [EXT_LIC]: LICENSE_SKU, [EXT_CREATOR]: RH_ID });
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(200);
    const statut = patches().filter((c) => JSON.stringify(c.body).includes('Validé'));
    expect(statut).toHaveLength(1);
    expect(statut[0]!.body).toEqual({ [EXT]: 'Validé', [HISTORY.validation]: `${DIR_ID}|${NOW.toISOString()}` });
    const avant = props(id)[HISTORY.validation];
    expect((await h.callRh('POST', `/api/demandes/${id}/valider`)).status).toBe(403);
    expect((await h.call('POST', `/api/demandes/${id}/valider`, RH_ID)).status).toBe(200); // reprise (déjà Validé)
    expect(props(id)[HISTORY.validation]).toBe(avant);
    expect(g().calls.filter((c) => c.method === 'PATCH' && JSON.stringify(c.body).includes(HISTORY.validation))).toHaveLength(1);
  });

  it('activer : statut et auteur dans le même PATCH ; régénérer compte les remises, sans toucher à l’activation', async () => {
    const id = compte('Validé', { [EXT_CREATOR]: RH_ID });
    g().groups.set(ARRIVANTS_GROUP, new Set());
    expect((await h.callRh('POST', `/api/demandes/${id}/activer`)).status).toBe(200);
    expect(props(id)[HISTORY.activation]).toBe(`${RH_ID}|${NOW.toISOString()}`);
    expect(patches().filter((c) => JSON.stringify(c.body).includes('Actif'))[0]!.body).toEqual({ [EXT]: 'Actif', [HISTORY.activation]: `${RH_ID}|${NOW.toISOString()}` });

    expect((await h.call('POST', `/api/demandes/${id}/regenerer`, DIR_ID, { motif: 'code_perdu' })).status).toBe(200);
    expect(props(id)[HISTORY.regeneration]).toBe(`${DIR_ID}|${NOW.toISOString()}|1`);
    expect((await h.callRh('POST', `/api/demandes/${id}/regenerer`, { motif: 'autre' })).status).toBe(200);
    expect(props(id)[HISTORY.regeneration]).toBe(`${RH_ID}|${NOW.toISOString()}|2`);
    expect(props(id)[HISTORY.activation]).toBe(`${RH_ID}|${NOW.toISOString()}`);
    // L'auteur de la régénération et la date de remise partent ensemble, avant le mot de passe.
    const ecrites = g().calls.filter((c) => c.method === 'PATCH').map((c) => Object.keys(c.body as object).some((k) => k === HISTORY.regeneration) ? 'regeneration' : 'autre');
    expect(ecrites.filter((e) => e === 'regeneration')).toHaveLength(2);
    // Aucun mot de passe ni nom dans l'historique ni dans le journal.
    expect(JSON.stringify(h.ctx.events)).not.toMatch(/Martin|Anna|exemple\.test|Kp7m/);
  });

  it('terminer : statut et date dans le même PATCH, auteur « systeme » pour la tâche', async () => {
    const id = compte('Actif', { [EXT_ACT]: '2026-10-26T10:00:00.000Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' }, { authenticator: true });
    g().groups.set(ARRIVANTS_GROUP, new Set([id]));
    expect((await h.callRh('POST', `/api/demandes/${id}/terminer`)).status).toBe(200);
    expect(props(id)[HISTORY.termine]).toBe(`${RH_ID}|${NOW.toISOString()}`);
    expect(patches().at(-1)!.body).toEqual({ [EXT]: 'Terminé', [HISTORY.termine]: `${RH_ID}|${NOW.toISOString()}` });
  });

  it('sans les extensions d’historique : mêmes écritures qu’avant, rien de plus', async () => {
    const sans = harness({});
    await sans.start();
    try {
      const id = sans.ctx.graph.addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut: 'EnAttente', extras: { [EXT_LIC]: LICENSE_SKU, [EXT_CREATOR]: RH_ID } });
      expect((await sans.call('POST', `/api/demandes/${id}/valider`)).status).toBe(200);
      expect(sans.ctx.graph.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ [EXT]: 'Validé' }]);
    } finally {
      await sans.stop();
    }
  });
});

describe('GET /api/demandes/:id', () => {
  const { h, g, compte } = suite();
  const lire = (id: string, as: (id: string) => Promise<Response> = (i) => h.callRh('GET', `/api/demandes/${i}`)) => as(id);
  type Detail = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('un compte Actif : identité, responsable, licence, groupe, dossier, onboarding et chronologie complète', async () => {
    const chef = g().addUser('chef@exemple.test', 'Chef Dupont');
    const id = compte('Actif', {
      [EXT_ACT]: '2026-10-26T10:00:00.000Z',
      lastPasswordChangeDateTime: '2026-10-26T12:30:00Z',
      [EXT_LIC]: LICENSE_SKU,
      [EXT_CREATOR]: RH_ID,
      [HISTORY.validation]: `${DIR_ID}|2026-10-20T09:00:00.000Z`,
      [HISTORY.activation]: `${RH_ID}|2026-10-26T10:00:00.000Z`,
      [HISTORY.regeneration]: `${DIR_ID}|2026-10-26T11:00:00.000Z|2`,
    }, { managerId: chef, authenticator: true });
    g().users.set(RH_ID, { id: RH_ID, upn: 'rh@exemple.test', accountEnabled: true, displayName: 'Camille RH', mail: null, props: {} });
    g().users.set(DIR_ID, { id: DIR_ID, upn: 'dir@exemple.test', accountEnabled: true, displayName: 'Claire Direction', mail: null, props: {} });
    g().groups.set(ARRIVANTS_GROUP, new Set([id]));
    g().addLicensed(id, LICENSE_GROUP, LICENSE_SKU);
    g().folders.set('Martin Anna', { id: 'f1', folder: {} });

    const res = await lire(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const d = (await res.json()) as Detail;
    expect(d).toMatchObject({
      id, nom: 'Anna Martin', upn: 'anna.martin@exemple.test', poste: 'Comptable', service: 'Finance', manager: { nom: 'Chef Dupont' }, dateArrivee: '2026-10-20',
      statut: 'Actif', etape: 3, licence: { libelle: 'Business Premium', etat: 'attribuee' }, groupeArrivants: { membre: true }, dossier: { etat: 'present', url: 'https://sp.test/existing' },
      onboarding: { motDePasse: true, authenticator: true, termine: true }, actions: ['regenerer'],
    });
    expect(d.historique).toEqual({
      enregistre: true,
      creation: { le: '2026-10-01T08:00:00Z', par: { nom: 'Camille RH' } },
      validation: { le: '2026-10-20T09:00:00.000Z', par: { nom: 'Claire Direction' } },
      activation: { le: '2026-10-26T10:00:00.000Z', par: { nom: 'Camille RH' } },
      regeneration: { le: '2026-10-26T11:00:00.000Z', par: { nom: 'Claire Direction' }, nombre: 2 },
      authenticator: { le: '2026-10-27T11:00:00Z' },
      motDePasse: { le: '2026-10-26T12:30:00Z' },
      termine: null,
    });
    // Ni objectId d'auteur ni nom d'appareil dans la réponse ; aucun nom dans le journal.
    expect(JSON.stringify(d)).not.toContain(DIR_ID);
    expect(JSON.stringify(d)).not.toContain('Appareil');
    expect(JSON.stringify(h.ctx.events)).not.toMatch(/Martin|Anna|Chef|Camille|Claire|exemple\.test/);
    expect(h.ctx.events.map((e) => e.action)).toEqual(['demande.detail']);
  });

  it('une demande en attente et une demande ancienne sans historique : étapes inconnues = null, jamais inventées', async () => {
    const attente = (await (await lire(compte('EnAttente', { [EXT_LIC]: LICENSE_SKU }))).json()) as Detail;
    expect(attente).toMatchObject({ statut: 'EnAttente', etape: 1, licence: { libelle: 'Business Premium', etat: 'choisie' }, groupeArrivants: null, dossier: null, manager: null, actions: [] });
    expect(attente.historique).toMatchObject({ creation: { par: null }, validation: null, activation: null, regeneration: null, authenticator: null, motDePasse: null, termine: null });

    const ancienne = (await (await lire(compte('Terminé', { [EXT_ACT]: '2026-10-01T10:00:00Z' }))).json()) as Detail;
    expect(ancienne).toMatchObject({ statut: 'Terminé', etape: 4, groupeArrivants: { membre: false }, actions: [] });
    expect(ancienne.historique).toMatchObject({ validation: null, activation: null, termine: null });
  });

  it('sans extensions d’historique : enregistre = false', async () => {
    const sans = harness({});
    await sans.start();
    try {
      const id = sans.ctx.graph.addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut: 'Validé' });
      const d = (await (await sans.callRh('GET', `/api/demandes/${id}`)).json()) as Detail;
      expect(d.historique.enregistre).toBe(false);
    } finally {
      await sans.stop();
    }
  });

  it('garde-fou : 404 pour un compte qui n’est pas une demande d’onboarding (jamais le profil d’un autre compte)', async () => {
    const autre = g().addUser('pdg@exemple.test', 'Le Patron', true);
    for (const id of [autre, '00000000-0000-4000-8000-0000000fffff', compte('Refusé')]) {
      const res = await lire(id);
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain('Patron');
    }
    expect(h.ctx.events.filter((e) => e.action === 'demande.introuvable')).toHaveLength(3);
  });

  it('id invalide : 400 ; sans rôle : 403 ; sans identité : 401 ; RH comme Direction y ont accès', async () => {
    const id = compte('Validé');
    expect((await h.callRh('GET', '/api/demandes/pas-un-guid')).status).toBe(400);
    expect((await h.callAs([], DIR_ID, 'GET', `/api/demandes/${id}`)).status).toBe(403);
    expect((await h.callAs(['Autre'], DIR_ID, 'GET', `/api/demandes/${id}`)).status).toBe(403);
    expect((await fetch(`${h.base}/api/demandes/${id}`)).status).toBe(401);
    expect((await h.call('GET', `/api/demandes/${id}`)).status).toBe(200);
  });

  it('une lecture annexe qui échoue ne fait pas échouer la page (tracée), jamais de reprise à l’aveugle', async () => {
    const id = compte('Actif', { [EXT_ACT]: '2026-10-26T10:00:00.000Z' });
    g().failOn.authenticator = 500;
    g().failOn.folderList = 500;
    const d = (await (await lire(id)).json()) as Detail;
    expect(d.onboarding).toEqual({ verification: 'echec' });
    expect(d.historique.authenticator).toBeNull();
    expect(h.ctx.events.some((e) => e.action === 'demande.echec' && e.etape === 'detail_authenticator')).toBe(true);

    const valide = compte('Validé', { [EXT_ACT]: '2026-10-26T10:00:00.000Z' });
    g().failOn.authenticator = undefined;
    const sansDossier = (await (await h.call('GET', `/api/demandes/${valide}`)).json()) as Detail;
    // Lecture du dossier : findFolder (GET root:/nom), pas la liste. Introuvable : l'action `reprendre` est proposée à la direction seulement.
    expect(sansDossier.dossier).toEqual({ etat: 'absent' });
    expect(sansDossier.actions).toEqual(['activer', 'reprendre']); // jour J passé : activer ; dossier absent : reprendre
    const pourRh = (await (await lire(valide)).json()) as Detail;
    expect(pourRh.actions).toEqual(['activer']); // RH : pas `reprendre` (droit approuver)
  });

  it('actions : les mêmes que GET /api/suivi pour la même personne', async () => {
    const attente = compte('EnAttente', { [EXT_LIC]: LICENSE_SKU });
    const valide = compte('Validé', {}, { hireDate: '2026-10-27' });
    g().folders.set('Martin Anna', { id: 'f1', folder: {} });
    const detail = async (id: string) => ((await (await h.call('GET', `/api/demandes/${id}`)).json()) as Detail).actions as string[];
    const suivi = (await (await h.call('GET', '/api/suivi')).json()) as { demandes: { id: string; actions: string[] }[] };
    for (const id of [attente, valide]) expect(await detail(id)).toEqual(suivi.demandes.find((d) => d.id === id)!.actions);
    expect(await detail(attente)).toEqual(['approuver', 'refuser']);
    expect(await detail(valide)).toEqual(['activer']);
  });
});
