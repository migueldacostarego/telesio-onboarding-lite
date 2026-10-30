import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../src/demandes';
import { loadConfig } from '../src/config';
import { KeyedLock } from '../src/lock';
import { ACTEUR_TERMINAISON, demarrerTerminaisonAuto, terminerComptesAcheves } from '../src/terminaison';
import { ARRIVANTS_GROUP, EXT, EXT_ACT, RH_ID, listen, principal, setup } from './helpers/ctx';

// NOW (ctx) = 2026-10-27 10:00 UTC. Activation le 26 à 10:00 ; mot de passe changé plus de 60 s après la remise = complet.
const ACTIVATION = '2026-10-26T10:00:00.000Z';

function monter(env: Record<string, string | undefined> = {}) {
  const ctx = setup(env);
  const g = ctx.graph;
  const deps = { config: ctx.config, directory: ctx.directory, audit: ctx.audit };
  const actif = (prenom: string, o: { motDePasse?: string | null; authenticator?: boolean; arrivants?: boolean } = {}) => {
    const id = g.addPending(EXT, {
      givenName: prenom,
      surname: 'Test',
      statut: 'Actif',
      hireDate: '2026-10-20',
      enabled: true,
      extras: { [EXT_ACT]: ACTIVATION, lastPasswordChangeDateTime: o.motDePasse === undefined ? '2026-10-26T12:00:00Z' : o.motDePasse },
    });
    if (o.authenticator ?? true) g.authenticators.add(id);
    if (o.arrivants ?? true) g.groups.set(ARRIVANTS_GROUP, (g.groups.get(ARRIVANTS_GROUP) ?? new Set()).add(id));
    return id;
  };
  const statut = (id: string) => g.users.get(id)!.props[EXT];
  const ecritures = () => g.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/checkMemberGroups'));
  return { ctx, g, deps, actif, statut, ecritures, lock: new KeyedLock() };
}

describe('terminerComptesAcheves : passage à Terminé par le serveur', () => {
  it('termine les comptes Actif dont l’onboarding est complet : retrait des arrivants puis statut, et ne touche pas les autres', async () => {
    const { ctx, g, deps, actif, statut, lock } = monter();
    const complet = actif('Complet');
    const sansAuth = actif('SansAuth', { authenticator: false });
    const sansMdp = actif('SansMdp', { motDePasse: '2026-10-26T10:00:30Z' }); // dans la marge de 60 s : c'est la remise, pas l'arrivant
    const bilan = await terminerComptesAcheves(deps, lock);

    expect(bilan).toEqual({ lus: 3, termines: 1, ignores: 0 });
    expect(statut(complet)).toBe('Terminé');
    expect(g.groups.get(ARRIVANTS_GROUP)!.has(complet)).toBe(false);
    for (const id of [sansAuth, sansMdp]) {
      expect(statut(id)).toBe('Actif');
      expect(g.groups.get(ARRIVANTS_GROUP)!.has(id)).toBe(true);
    }
    expect(ctx.events.filter((e) => e.action === 'onboarding.termine_auto')).toEqual([{ action: 'onboarding.termine_auto', actor: ACTEUR_TERMINAISON, outcome: 'ok', cible: complet }]);
  });

  it('trace chaque passage avec l’objectId seulement : jamais de nom, d’UPN ni de domaine', async () => {
    const { ctx, deps, actif, lock } = monter();
    const a = actif('Alice');
    const b = actif('Bruno');
    await terminerComptesAcheves(deps, lock);
    const auto = ctx.events.filter((e) => e.action === 'onboarding.termine_auto');
    expect(auto.map((e) => e.cible).sort()).toEqual([a, b].sort());
    expect(auto.every((e) => e.actor === ACTEUR_TERMINAISON && e.outcome === 'ok')).toBe(true);
    const journal = JSON.stringify(ctx.events);
    expect(journal).not.toMatch(/Alice|Bruno|Test|exemple\.test/);
  });

  it('un compte déjà Terminé ou à un autre statut n’est pas lu ; rien d’écrit quand rien n’est complet', async () => {
    const { g, deps, actif, ecritures, lock } = monter();
    actif('Incomplet', { authenticator: false });
    g.addPending(EXT, { givenName: 'Fini', surname: 'Test', statut: 'Terminé', enabled: true });
    g.addPending(EXT, { givenName: 'Valide', surname: 'Test', statut: 'Validé' });
    expect(await terminerComptesAcheves(deps, lock)).toEqual({ lus: 1, termines: 0, ignores: 0 });
    expect(ecritures()).toEqual([]);
  });

  it('lecture de l’onboarding impossible pour un compte : il est laissé tel quel, sans empêcher la liste', async () => {
    const { g, deps, actif, statut, lock } = monter();
    const id = actif('Illisible');
    g.failOn.authenticator = 403;
    expect(await terminerComptesAcheves(deps, lock)).toEqual({ lus: 1, termines: 0, ignores: 0 });
    expect(statut(id)).toBe('Actif');
  });

  it('un échec d’écriture n’arrête pas la suite et se rejoue au passage suivant (rejouable)', async () => {
    const { ctx, g, deps, actif, statut, lock } = monter();
    const a = actif('Alice');
    const b = actif('Bruno');
    g.failOn.statusPatch = 403;
    const echec = await terminerComptesAcheves(deps, lock);
    expect(echec).toEqual({ lus: 2, termines: 0, ignores: 2 });
    expect(ctx.events.filter((e) => e.action === 'onboarding.termine_auto')).toEqual([]);
    expect(ctx.events.find((e) => e.action === 'demande.echec')).toMatchObject({ etape: 'statut', http: 403 });

    g.failOn.statusPatch = undefined;
    expect(await terminerComptesAcheves(deps, lock)).toEqual({ lus: 2, termines: 2, ignores: 0 });
    expect([statut(a), statut(b)]).toEqual(['Terminé', 'Terminé']);
  });

  it('un compte qu’une autre action occupe (verrou en mémoire) est laissé au passage suivant', async () => {
    const { deps, actif, statut, lock } = monter();
    const occupe = actif('Occupe');
    const libre = actif('Libre');
    let relacher!: () => void;
    const tenu = lock.run(occupe.toLowerCase(), () => new Promise<void>((r) => (relacher = r)));
    expect(await terminerComptesAcheves(deps, lock)).toEqual({ lus: 2, termines: 1, ignores: 1 });
    expect([statut(occupe), statut(libre)]).toEqual(['Actif', 'Terminé']);
    relacher();
    await tenu;
    expect(await terminerComptesAcheves(deps, lock)).toMatchObject({ termines: 1 });
    expect(statut(occupe)).toBe('Terminé');
  });

  it('un compte déjà sorti du groupe des arrivants (reprise après échec partiel) est terminé sans erreur', async () => {
    const { deps, actif, statut, lock } = monter();
    const id = actif('Reprise', { arrivants: false });
    expect(await terminerComptesAcheves(deps, lock)).toMatchObject({ termines: 1 });
    expect(statut(id)).toBe('Terminé');
  });

  it('liste Graph impossible : l’erreur remonte (la tâche la trace) et rien n’est écrit', async () => {
    const { g, deps, actif, ecritures, lock } = monter();
    actif('Alice');
    g.failOn.list = 403;
    await expect(terminerComptesAcheves(deps, lock)).rejects.toBeTruthy();
    expect(ecritures()).toEqual([]);
  });

  it('sans le groupe des arrivants ou l’extension d’activation : 503, aucune lecture', async () => {
    for (const env of [{ ARRIVANTS_GROUP_ID: undefined }, { ENTRA_ACTIVATION_EXTENSION: undefined }]) {
      const { g, deps, lock } = monter(env);
      await expect(terminerComptesAcheves(deps, lock)).rejects.toMatchObject({ status: 503 } satisfies Partial<ServiceError>);
      expect(g.calls).toEqual([]);
    }
  });
});

describe('demarrerTerminaisonAuto : un passage toutes les 5 minutes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('premier passage après le délai, puis toutes les périodes ; l’arrêt les stoppe', async () => {
    const { deps, actif, statut, lock } = monter();
    const a = actif('Alice');
    const stop = demarrerTerminaisonAuto(deps, lock, { intervalleMs: 300_000, premierDelaiMs: 30_000 });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(statut(a)).toBe('Actif');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(statut(a)).toBe('Terminé');

    const b = actif('Bruno');
    await vi.advanceTimersByTimeAsync(250_000);
    expect(statut(b)).toBe('Actif'); // pas avant 5 minutes après le passage précédent
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statut(b)).toBe('Terminé');

    stop();
    const c = actif('Camille');
    await vi.advanceTimersByTimeAsync(10 * 300_000);
    expect(statut(c)).toBe('Actif');
  });

  it('jamais deux passages en même temps : le suivant n’est planifié qu’après la fin du précédent', async () => {
    const { deps, actif, lock } = monter();
    actif('Alice');
    let lectures = 0;
    let liberer!: () => void;
    const lente = new Promise<void>((r) => (liberer = r));
    const original = deps.directory.listByStatut.bind(deps.directory);
    deps.directory.listByStatut = async (...a: Parameters<typeof original>) => {
      lectures++;
      await lente;
      return original(...a);
    };
    const stop = demarrerTerminaisonAuto(deps, lock, { intervalleMs: 60_000, premierDelaiMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(lectures).toBe(1); // le premier passage attend toujours : aucun autre n'a démarré
    liberer();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(lectures).toBe(2);
    stop();
  });

  it('une erreur de passage est tracée (étape et code, pas de message brut) et n’arrête pas la tâche', async () => {
    const { ctx, g, deps, actif, statut, lock } = monter();
    const id = actif('Alice');
    g.failOn.list = 403;
    const stop = demarrerTerminaisonAuto(deps, lock, { intervalleMs: 60_000, premierDelaiMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ctx.events.find((e) => e.action === 'terminaison.passage')).toMatchObject({ actor: ACTEUR_TERMINAISON, outcome: 'erreur', http: 403 });
    expect(statut(id)).toBe('Actif');
    g.failOn.list = undefined;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(statut(id)).toBe('Terminé');
    stop();
  });

  it('trace un bilan seulement quand quelque chose s’est passé (pas un événement toutes les 5 minutes pour rien)', async () => {
    const { ctx, deps, actif, lock } = monter();
    const stop = demarrerTerminaisonAuto(deps, lock, { intervalleMs: 60_000, premierDelaiMs: 1_000 });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(ctx.events.filter((e) => e.action === 'terminaison.passage')).toEqual([]);
    actif('Alice');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(ctx.events.filter((e) => e.action === 'terminaison.passage')).toEqual([{ action: 'terminaison.passage', actor: ACTEUR_TERMINAISON, outcome: 'ok', lus: 1, termines: 1, ignores: 0 }]);
    stop();
  });

  it('chaque passage dépose trois mesures (lus, termines, ignores), même sans rien à faire, et aucune n\u2019entre dans le journal d\u2019audit', async () => {
    const { ctx, deps, actif, lock } = monter();
    const stop = demarrerTerminaisonAuto(deps, lock, { intervalleMs: 60_000, premierDelaiMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ctx.metrics).toEqual([
      { name: 'terminaison.lus', value: 0 },
      { name: 'terminaison.termines', value: 0 },
      { name: 'terminaison.ignores', value: 0 },
    ]);
    expect(ctx.events).toEqual([]); // rien à faire : le journal d'audit reste vide

    actif('Alice');
    actif('Bob', { authenticator: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.metrics.slice(3)).toEqual([
      { name: 'terminaison.lus', value: 2 },
      { name: 'terminaison.termines', value: 1 },
      { name: 'terminaison.ignores', value: 0 },
    ]);
    // Un seul passage de mesures par période : pas de doublon.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.metrics).toHaveLength(9);
    expect(JSON.stringify(ctx.metrics)).not.toMatch(/Alice|Bob|exemple\.test|-/);
    stop();
  });

  it('un passage en erreur ne dépose pas de mesures (l’événement d’erreur le dit)', async () => {
    const { ctx, deps, lock } = monter();
    ctx.graph.failOn.list = 403;
    const stop = demarrerTerminaisonAuto(deps, lock, { intervalleMs: 60_000, premierDelaiMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ctx.metrics).toEqual([]);
    expect(ctx.events.find((e) => e.action === 'terminaison.passage')).toMatchObject({ outcome: 'erreur' });
    stop();
  });
});

describe('TERMINAISON_INTERVAL_MS', () => {
  const base = { UPN_DOMAIN: 'exemple.test', ENTRA_STATUS_EXTENSION: EXT };
  it('défaut 5 minutes, 0 désactive, une valeur raisonnable est acceptée', () => {
    expect(loadConfig(base).terminaisonIntervalMs).toBe(300_000);
    expect(loadConfig({ ...base, TERMINAISON_INTERVAL_MS: '0' }).terminaisonIntervalMs).toBe(0);
    expect(loadConfig({ ...base, TERMINAISON_INTERVAL_MS: '600000' }).terminaisonIntervalMs).toBe(600_000);
  });
  it('refuse une valeur absurde (trop courte, négative, non entière, non numérique)', () => {
    for (const v of ['1000', '-5', '60000.5', 'abc']) expect(() => loadConfig({ ...base, TERMINAISON_INTERVAL_MS: v })).toThrow(/TERMINAISON_INTERVAL_MS/);
  });
});

describe('les routes et la tâche partagent le même verrou', () => {
  it('une action en cours sur un compte (verrou fourni à l’application) : la route répond 409 action_en_cours, la tâche passe son tour', async () => {
    const lock = new KeyedLock();
    const ctx = setup({}, { lock });
    const g = ctx.graph;
    const id = g.addPending(EXT, { givenName: 'Alice', surname: 'Test', statut: 'Actif', hireDate: '2026-10-20', enabled: true, extras: { [EXT_ACT]: ACTIVATION, lastPasswordChangeDateTime: '2026-10-26T12:00:00Z' } });
    g.authenticators.add(id);
    g.groups.set(ARRIVANTS_GROUP, new Set([id]));
    const srv = await listen(ctx.app);
    let relacher!: () => void;
    const tenu = lock.run(id, () => new Promise<void>((r) => (relacher = r)));
    try {
      const res = await fetch(`${srv.base}/api/demandes/${id}/terminer`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ms-client-principal': principal(['RH'], RH_ID) }, body: '{}' });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'action_en_cours' });
      expect(await terminerComptesAcheves({ config: ctx.config, directory: ctx.directory, audit: ctx.audit }, lock)).toMatchObject({ termines: 0, ignores: 1 });
      expect(g.users.get(id)!.props[EXT]).toBe('Actif');
    } finally {
      relacher();
      await tenu;
      await srv.close();
    }
  });
});
