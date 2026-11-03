import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { KeyedLock } from '../src/lock';
import { terminerComptesAcheves } from '../src/terminaison';
import { ARRIVANTS_GROUP, EXT, EXT_ACT, EXT_LIC, LICENSE_SKU } from './helpers/ctx';
import { harness } from './helpers/harness';

// Unité administrative à gestion restreinte des comptes d'onboarding (audit M8).
const UNITE = '99999999-0000-4000-8000-0000000000e1';
const TODAY = '2026-10-27';

describe('ENTRA_ONBOARDING_UNIT_ID', () => {
  it('GUID facultatif, mis en minuscules ; autre valeur refusée au démarrage', () => {
    expect(loadConfig({}).onboardingUnitId).toBeUndefined();
    expect(loadConfig({ ENTRA_ONBOARDING_UNIT_ID: UNITE.toUpperCase() }).onboardingUnitId).toBe(UNITE);
    expect(() => loadConfig({ ENTRA_ONBOARDING_UNIT_ID: 'unite-onboarding' })).toThrow(/ENTRA_ONBOARDING_UNIT_ID invalide/);
  });
});

describe('unité administrative des comptes d’onboarding', () => {
  const h = harness({ ENTRA_ONBOARDING_UNIT_ID: UNITE });
  let managerId: string;
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
    managerId = h.ctx.graph.addUser('chef@exemple.test', 'Camille Responsable');
  });
  afterAll(() => h.stop());
  const g = () => h.ctx.graph;
  const membres = () => g().units.get(UNITE) ?? new Set<string>();
  /** Compte d'onboarding ; `dansUnite` : créé par l'application (membre de l'unité). */
  const compte = (statut: string, dansUnite: boolean, o: { enabled?: boolean; extras?: Record<string, unknown> } = {}) => {
    const id = g().addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut, hireDate: TODAY, enabled: o.enabled, managerId, extras: { [EXT_LIC]: LICENSE_SKU, ...o.extras } });
    if (dansUnite) g().units.set(UNITE, membres().add(id));
    return id;
  };
  const ecritures = () =>
    g().calls.filter((c) => c.method !== 'GET' && !/\/check(MemberGroups|MemberObjects)$/.test(c.path));
  const body = () => ({ prenom: 'Éloïse', nom: 'Durand', dateArrivee: '2026-11-03', poste: 'Comptable', service: 'Finance', managerId, typeContrat: 'Employé' });

  it('création : le compte rejoint l’unité juste après sa création, avant le manager', async () => {
    const res = await h.callRh('POST', '/api/demandes', body());
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(membres().has(id)).toBe(true);
    expect(ecritures().map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /users',
      `POST /directory/administrativeUnits/${UNITE}/members/$ref`,
      `PUT /users/${id}/manager/$ref`,
    ]);
  });

  it('création : ajout réessayé tant que le compte n’est pas répliqué (404)', async () => {
    g().unitAddNotFoundLeft = 2;
    const res = await h.callRh('POST', '/api/demandes', body());
    expect(res.status).toBe(201);
    expect(membres().size).toBe(1);
  });

  it('création : ajout impossible, le compte est supprimé et la demande n’aboutit pas (502 qui nomme l’étape)', async () => {
    g().failOn.unitAdd = 403;
    const res = await h.callRh('POST', '/api/demandes', body());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Le service d’annuaire a échoué ; la demande n’a pas abouti', etape: 'unite_ajout' });
    expect(g().deleted).toHaveLength(1);
    expect([...g().users.values()].filter((u) => u.props[EXT])).toEqual([]);
    expect(h.ctx.events.map((e) => e.action)).toContain('demande.compte_supprime');
  });

  it('un compte hors de l’unité n’est pas une demande, même avec un statut posé à la main : 404, rien n’est écrit', async () => {
    const cibles = [
      ['valider', compte('EnAttente', false)],
      ['refuser', compte('EnAttente', false)],
      ['reprendre', compte('Validé', false)],
      ['activer', compte('Validé', false)],
      ['regenerer', compte('Actif', false, { enabled: true })],
      ['terminer', compte('Actif', false, { enabled: true })],
    ] as const;
    for (const [action, id] of cibles) {
      const corps = action === 'refuser' ? { motif: 'Doublon' } : action === 'regenerer' ? { motif: 'code_perdu' } : {};
      const res = await h.call('POST', `/api/demandes/${id}/${action}`, undefined, corps);
      expect([action, res.status]).toEqual([action, 404]);
      expect(await res.json()).toEqual({ error: 'Demande introuvable' });
    }
    expect(ecritures()).toEqual([]);
    expect(g().deleted).toEqual([]);
    expect(h.ctx.events.filter((e) => e.action === 'demande.hors_unite')).toHaveLength(cibles.length);
  });

  it('un compte de l’unité suit le parcours habituel', async () => {
    const id = compte('EnAttente', true);
    expect((await h.call('POST', `/api/demandes/${id}/valider`)).status).toBe(200);
    expect((await h.call('POST', `/api/demandes/${id}/activer`)).status).toBe(200);
    expect(g().users.get(id)!.props[EXT]).toBe('Actif');
  });

  it('appartenance illisible : 502, rien n’est écrit (jamais d’action sans preuve)', async () => {
    const id = compte('EnAttente', true);
    g().failOn.unitCheck = 403;
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { etape: string }).etape).toBe('unite_lecture');
    expect(ecritures()).toEqual([]);
  });

  describe('Terminé : le compte quitte l’unité', () => {
    const complet = (dansUnite = true) => {
      const id = compte('Actif', dansUnite, {
        enabled: true,
        extras: { [EXT_ACT]: '2026-10-26T10:00:00.000Z', lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' },
      });
      g().authenticators.add(id);
      g().groups.set(ARRIVANTS_GROUP, (g().groups.get(ARRIVANTS_GROUP) ?? new Set()).add(id));
      return id;
    };
    const deps = () => ({ config: h.ctx.config, directory: h.ctx.directory, audit: h.ctx.audit });

    it('statut Terminé d’abord, puis retrait de l’unité (route et tâche du serveur)', async () => {
      const parRoute = complet();
      expect((await h.callRh('POST', `/api/demandes/${parRoute}/terminer`)).status).toBe(200);
      const parTache = complet();
      expect(await terminerComptesAcheves(deps(), new KeyedLock())).toEqual({ lus: 1, termines: 1, ignores: 0 });
      for (const id of [parRoute, parTache]) {
        expect(g().users.get(id)!.props[EXT]).toBe('Terminé');
        expect(membres().has(id)).toBe(false);
      }
      const ordre = ecritures().filter((c) => c.path.includes(parRoute)).map((c) => `${c.method} ${c.path.includes('administrativeUnits') ? 'unite' : c.path.includes('/groups/') ? 'groupe' : 'statut'}`);
      expect(ordre).toEqual(['DELETE groupe', 'PATCH statut', 'DELETE unite']);
      expect(h.ctx.events.filter((e) => e.action === 'onboarding.unite_retrait').map((e) => e.cible)).toEqual([parRoute, parTache]);
    });

    it('retrait en échec : Terminé reste écrit (502 qui nomme l’étape) ; un nouvel appel refait le retrait', async () => {
      const id = complet();
      g().failOn.unitRemove = 403;
      const res = await h.callRh('POST', `/api/demandes/${id}/terminer`);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'unite_retrait', statut: 'Terminé' });
      expect(g().users.get(id)!.props[EXT]).toBe('Terminé');
      expect(membres().has(id)).toBe(true);

      delete g().failOn.unitRemove;
      const reprise = await h.callRh('POST', `/api/demandes/${id}/terminer`);
      expect(reprise.status).toBe(200);
      expect(await reprise.json()).toEqual({ id, statut: 'Terminé', deja: true });
      expect(membres().has(id)).toBe(false);
    });

    it('un compte Terminé hors de l’unité : « déjà Terminé », sans aucune écriture', async () => {
      const id = compte('Terminé', false, { enabled: true });
      const res = await h.callRh('POST', `/api/demandes/${id}/terminer`);
      expect(await res.json()).toEqual({ id, statut: 'Terminé', deja: true });
      expect(ecritures()).toEqual([]);
    });
  });
});

describe('sans unité configurée', () => {
  const h = harness();
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());

  it('aucun appel d’unité administrative : ni ajout, ni contrôle, ni retrait', async () => {
    const managerId = h.ctx.graph.addUser('chef@exemple.test', 'Camille Responsable');
    const res = await h.callRh('POST', '/api/demandes', { prenom: 'Éloïse', nom: 'Durand', dateArrivee: '2026-11-03', poste: 'Comptable', service: 'Finance', managerId, typeContrat: 'Employé' });
    const { id } = (await res.json()) as { id: string };
    h.ctx.graph.users.get(id)!.props[EXT_LIC] = LICENSE_SKU;
    expect((await h.call('POST', `/api/demandes/${id}/valider`)).status).toBe(200);
    expect(h.ctx.graph.calls.some((c) => /administrativeUnits|checkMemberObjects/.test(c.path))).toBe(false);
  });
});
