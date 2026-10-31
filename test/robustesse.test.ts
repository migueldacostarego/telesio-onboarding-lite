import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { KeyedLock } from '../src/lock';
import { ARRIVANTS_GROUP, EXT, EXT_CREATOR, EXT_LIC, LICENSE_SKU, RH_ID } from './helpers/ctx';
import { harness } from './helpers/harness';

// Échecs partiels, garde-fous et verrous : les cas que le parcours nominal ne couvre pas (revue d'audit du 2026-10-31).
const TODAY = '2026-10-27'; // NOW (ctx) = 2026-10-27 10:00 UTC

function suite(opts: Parameters<typeof harness>[1] = {}) {
  const h = harness({}, opts);
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    await h.start();
  });
  afterAll(() => h.stop());
  const g = () => h.ctx.graph;
  const compte = (statut: string, o: { hireDate?: string; enabled?: boolean } = {}) =>
    g().addPending(EXT, {
      givenName: 'Anna',
      surname: 'Martin',
      statut,
      hireDate: o.hireDate ?? TODAY,
      enabled: o.enabled ?? false,
      extras: { [EXT_LIC]: LICENSE_SKU, [EXT_CREATOR]: RH_ID },
    });
  const ecritures = () => g().calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/checkMemberGroups'));
  const evenements = () => h.ctx.events.map((e) => e.action as string);
  return { h, g, compte, ecritures, evenements };
}

describe('activer : garde-fous', () => {
  const { h, g, compte, ecritures } = suite();
  const activer = (id: string) => h.callRh('POST', `/api/demandes/${id}/activer`);

  it('409 date_arrivee_absente quand le compte n’a pas de date d’arrivée : rien n’est écrit', async () => {
    const id = compte('Validé');
    delete g().users.get(id)!.props.employeeHireDate;
    const res = await activer(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ raison: 'date_arrivee_absente' });
    expect(ecritures()).toEqual([]);
  });

  it('409 date_arrivee_future avant le jour J : rien n’est écrit', async () => {
    const id = compte('Validé', { hireDate: '2026-10-28' });
    const res = await activer(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ raison: 'date_arrivee_future' });
    expect(ecritures()).toEqual([]);
  });

  it('régénérer un compte Actif désactivé : 409 compte_desactive, rien n’est écrit', async () => {
    const id = compte('Actif', { enabled: false });
    const res = await h.callRh('POST', `/api/demandes/${id}/regenerer`, { motif: 'code_perdu' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ raison: 'compte_desactive' });
    expect(ecritures()).toEqual([]);
  });
});

describe('activer : échec en cours de route, puis reprise', () => {
  const { h, g, compte } = suite();
  const activer = (id: string) => h.callRh('POST', `/api/demandes/${id}/activer`);

  it('échec du groupe des arrivants : 502 nommant l’étape, compte activé mais resté Validé, aucun mot de passe ; un nouvel essai aboutit', async () => {
    const id = compte('Validé');
    g().failOn.groupAdd = 403;
    const res = await activer(id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'groupe_arrivants', statut: 'Validé' });
    expect(g().users.get(id)!.accountEnabled).toBe(true);
    expect(g().users.get(id)!.props[EXT]).toBe('Validé');
    expect(g().passwords.get(id)).toBeUndefined();

    // Reprise sur un compte déjà activé : l'activation n'est pas refaite, le reste l'est.
    g().failOn.groupAdd = undefined;
    const retry = await activer(id);
    expect(retry.status).toBe(200);
    expect(g().users.get(id)!.props[EXT]).toBe('Actif');
    expect(g().groups.get(ARRIVANTS_GROUP)?.has(id)).toBe(true);
    expect(g().passwords.get(id)).toHaveLength(1);
  });

  it('échec de la date de remise : 502 activation_date, aucun mot de passe posé', async () => {
    // Compte déjà activé (reprise) : l'étape accountEnabled est sautée, le premier PATCH est donc la date de remise.
    const id = compte('Validé', { enabled: true });
    g().failOn.patch = 400;
    const res = await activer(id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'activation_date', statut: 'Validé' });
    expect(g().passwords.get(id)).toBeUndefined();
  });
});

describe('régénérer : échec de la remise', () => {
  const { h, g, compte } = suite();

  it('502 mot_de_passe, statut Actif conservé, aucun mot de passe dans la réponse ni dans Entra', async () => {
    const id = compte('Actif', { enabled: true });
    g().groups.set(ARRIVANTS_GROUP, new Set([id]));
    g().failOn.passwordPatch = 403;
    const res = await h.callRh('POST', `/api/demandes/${id}/regenerer`, { motif: 'code_perdu' });
    expect(res.status).toBe(502);
    const corps = await res.text();
    expect(JSON.parse(corps)).toMatchObject({ etape: 'mot_de_passe', statut: 'Actif' });
    expect(corps).not.toContain('motDePasseTemporaire');
    expect(g().passwords.get(id)).toBeUndefined();
    expect(g().users.get(id)!.props[EXT]).toBe('Actif');
  });
});

describe('valider : écriture du statut en échec', () => {
  const { h, g, compte, evenements } = suite();

  it('502 statut, le compte reste EnAttente et revalidable ; le nouvel essai ne recompte pas la licence', async () => {
    const id = compte('EnAttente');
    g().failOn.statusPatch = 400;
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'statut' });
    expect(g().users.get(id)!.props[EXT]).toBe('EnAttente');
    expect(evenements()).toContain('demande.echec');

    g().failOn.statusPatch = undefined;
    const retry = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ statut: 'Validé', licence: { deja: true } });
  });
});

describe('création : refus avant écriture', () => {
  const { h, g, ecritures } = suite();
  const demande = (managerId: string) => ({ prenom: 'Anna', nom: 'Martin', dateArrivee: '2026-11-03', poste: 'Comptable', service: 'Finance', managerId, typeContrat: 'Employé' });

  it('manager au compte désactivé : 400 sur managerId, rien n’est créé', async () => {
    const manager = g().addUser('ancien@exemple.test', 'Ancien Responsable', false);
    const res = await h.callRh('POST', '/api/demandes', demande(manager));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: { managerId: 'compte désactivé' } });
    expect(ecritures()).toEqual([]);
  });

  it('20 homonymes déjà présents : 409 sans identifiant disponible, rien n’est créé', async () => {
    const manager = g().addUser('chef@exemple.test', 'Camille Responsable');
    g().addUser('anna.martin@exemple.test');
    for (let n = 2; n <= 20; n++) g().addUser(`anna.martin${n}@exemple.test`);
    const res = await h.callRh('POST', '/api/demandes', demande(manager));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'Aucun identifiant disponible pour ce nom' });
    expect(ecritures()).toEqual([]);
  });

  it('échec de la lecture des licences : 502 licence_disponibilite, rien n’est créé', async () => {
    const manager = g().addUser('chef@exemple.test', 'Camille Responsable');
    g().failOn.skus = 500;
    const res = await h.callRh('POST', '/api/demandes', demande(manager));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ etape: 'licence_disponibilite' });
    expect(ecritures()).toEqual([]);
  });
});

describe('annuaire : terme trop long', () => {
  const { h } = suite();
  it('400 au-delà de 64 caractères, avec le détail', async () => {
    const res = await h.callRh('GET', `/api/annuaire?q=${'a'.repeat(65)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: { q: '2 à 64 caractères requis' } });
  });
});

describe('verrou par compte : une action en cours', () => {
  const lock = new KeyedLock();
  const { h, g, compte, ecritures } = suite({ lock });

  it.each([
    ['valider', 'EnAttente', 'dir', {}],
    ['activer', 'Validé', 'rh', {}],
    ['regenerer', 'Actif', 'rh', { motif: 'code_perdu' }],
  ] as const)('%s : 409 action_en_cours, aucun appel Graph', async (action, statut, qui, corps) => {
    const id = compte(statut, { enabled: statut === 'Actif' });
    let liberer!: () => void;
    const occupe = lock.run(id.toLowerCase(), () => new Promise<void>((r) => (liberer = r)));
    g().calls.length = 0;
    const res = qui === 'dir' ? await h.call('POST', `/api/demandes/${id}/${action}`, undefined, corps) : await h.callRh('POST', `/api/demandes/${id}/${action}`, corps);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'action_en_cours' });
    expect(g().calls).toEqual([]);
    expect(ecritures()).toEqual([]);
    liberer();
    await occupe;
  });
});

describe('acces.refuse : route auditée', () => {
  const { h } = suite();
  const refus = () => h.ctx.events.filter((e) => e.action === 'acces.refuse');

  it('un identifiant qui n’est pas un GUID n’est pas écrit tel quel dans l’audit (texte de l’appelant, longueur libre)', async () => {
    const junk = 'x'.repeat(3000);
    const res = await h.callRh('POST', `/api/demandes/${junk}/valider`);
    expect(res.status).toBe(403); // le droit est contrôlé avant l'identifiant
    expect(refus()[0]).toMatchObject({ route: 'POST /api/demandes/:id/valider', reason: 'droit_manquant' });
    expect(JSON.stringify(h.ctx.events)).not.toContain('xxxx');
  });

  it('un GUID est conservé (il identifie la cible du refus)', async () => {
    const id = 'cccccccc-0000-4000-8000-0000000000c1';
    await h.callRh('POST', `/api/demandes/${id}/valider`);
    expect(refus()[0]).toMatchObject({ route: `POST /api/demandes/${id}/valider` });
  });
});

describe('valider : compte déjà activé', () => {
  const { h, g, compte, ecritures } = suite();

  it('un compte Validé déjà activé n’est pas revalidé (409) : seul reprendre l’accepte, rien n’est écrit', async () => {
    const id = compte('Validé', { enabled: true });
    const res = await h.call('POST', `/api/demandes/${id}/valider`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ statut: 'inconnu' });
    expect(ecritures()).toEqual([]);
    expect(g().users.get(id)!.props[EXT]).toBe('Validé');
  });
});

describe('GET /api/suivi : comptes Terminé lus par lots', () => {
  const { h, g } = suite();

  it('au plus 5 lectures de l’avancement en même temps, quel que soit le nombre de comptes Terminé', async () => {
    for (let n = 0; n < 12; n++) {
      g().addPending(EXT, { givenName: `Fini${n}`, surname: 'Test', statut: 'Terminé', hireDate: '2026-10-20', enabled: true });
    }
    let enCours = 0;
    let max = 0;
    const lire = h.ctx.directory.getOnboardingProgress.bind(h.ctx.directory);
    h.ctx.directory.getOnboardingProgress = async (...args) => {
      enCours++;
      max = Math.max(max, enCours);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await lire(...args);
      } finally {
        enCours--;
      }
    };
    const res = await h.call('GET', '/api/suivi');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { demandes: unknown[] }).demandes).toHaveLength(12);
    expect(max).toBe(5);
  });
});
