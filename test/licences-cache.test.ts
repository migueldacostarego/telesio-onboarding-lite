import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DIR_ID, EXT, EXT_LIC, LICENSE_SKU, NOW } from './helpers/ctx';
import { harness } from './helpers/harness';

/** Cache de 60 s sur GET /subscribedSkus : affichage du formulaire RH uniquement. */
describe('cache de GET /subscribedSkus', () => {
  let clock = NOW.getTime();
  const h = harness({}, { now: () => new Date(clock) });
  let managerId: string;
  beforeEach(async () => {
    if (h.ctx) await h.stop();
    clock = NOW.getTime();
    await h.start();
    managerId = h.ctx.graph.addUser('chef@exemple.test', 'Camille Responsable');
  });
  afterAll(() => h.stop());

  const skuCalls = () => h.ctx.graph.calls.filter((c) => c.path === '/subscribedSkus').length;
  const free = async () => {
    const res = await h.callRh('GET', '/api/licences');
    expect(res.status).toBe(200);
    const { licences } = (await res.json()) as { licences: { skuId: string; disponibles: number }[] };
    return licences.find((l) => l.skuId === LICENSE_SKU)!.disponibles;
  };
  const sku = () => h.ctx.graph.skus.get(LICENSE_SKU)!;
  const pending = () => h.ctx.graph.addPending(EXT, { givenName: 'Anna', surname: 'Martin', statut: 'EnAttente', managerId, extras: { [EXT_LIC]: LICENSE_SKU } });
  const demande = () =>
    h.callRh('POST', '/api/demandes', { prenom: 'Léa', nom: 'Durand', dateArrivee: '2026-11-03', poste: 'Comptable', service: 'Finance', managerId, typeContrat: 'Employé' });

  it('sert la liste depuis la mémoire pendant 60 s, puis relit', async () => {
    expect(await free()).toBe(4);
    sku().consumed = 3;
    clock += 59_000;
    expect(await free()).toBe(4);
    expect(skuCalls()).toBe(1);
    clock += 1_000;
    expect(await free()).toBe(2);
    expect(skuCalls()).toBe(2);
  });

  it('ne conserve pas un échec : la lecture suivante réessaie', async () => {
    h.ctx.graph.failOn.skus = 403;
    expect((await h.callRh('GET', '/api/licences')).status).toBe(502);
    h.ctx.graph.failOn.skus = undefined;
    expect(await free()).toBe(4);
    expect(skuCalls()).toBe(2);
  });

  it('la validation direction relit en direct, même si la liste en cache affiche une unité libre', async () => {
    const id = pending();
    expect(await free()).toBe(4);
    sku().consumed = sku().enabled;
    const avant = skuCalls();
    const res = await h.call('POST', `/api/demandes/${id}/valider`, DIR_ID);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Aucune licence disponible', code: 'licence_indisponible' });
    expect(skuCalls()).toBe(avant + 1);
    expect(h.ctx.graph.users.get(id)!.props[EXT]).toBe('EnAttente');
    // La validation invalide le cache : le formulaire ne montre plus l'ancien décompte.
    expect(await free()).toBe(0);
  });

  it('la création de demande relit en direct, et le refus rafraîchit la liste', async () => {
    expect(await free()).toBe(4);
    sku().consumed = sku().enabled;
    const avant = skuCalls();
    const res = await demande();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'licence_indisponible' });
    expect(skuCalls()).toBe(avant + 1);
    expect(await free()).toBe(0);
  });

  it('une validation réussie invalide le cache : le décompte baisse sans attendre 60 s', async () => {
    const id = pending();
    expect(await free()).toBe(4);
    expect((await h.call('POST', `/api/demandes/${id}/valider`, DIR_ID)).status).toBe(200);
    expect(await free()).toBe(3);
  });
});
