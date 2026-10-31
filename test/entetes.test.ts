import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listen, principal, setup } from './helpers/ctx';

// En-têtes de sécurité communs à toutes les réponses (API, front, healthz, erreurs, 404) : la CSP du front est testée dans web.test.ts.
describe('en-têtes de sécurité', () => {
  let srv: { base: string; close: () => Promise<void> };
  beforeAll(async () => {
    srv = await listen(setup().app);
  });
  afterAll(() => srv.close());

  const attendus = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000',
    'cross-origin-resource-policy': 'same-origin',
  };

  it.each([
    ['healthz', '/healthz', {}],
    ['API authentifiée', '/api/moi', { 'x-ms-client-principal': principal(['RH']) }],
    ['API refusée (401)', '/api/suivi', {}],
    ['front', '/app/', {}],
    ['route inconnue', '/inconnu', {}],
  ])('%s', async (_nom, chemin, headers) => {
    const res = await fetch(`${srv.base}${chemin}`, { headers, redirect: 'manual' });
    for (const [nom, valeur] of Object.entries(attendus)) expect(res.headers.get(nom), nom).toBe(valeur);
  });

  it('un corps JSON invalide (400 du gestionnaire d’erreurs) porte aussi les en-têtes', async () => {
    const res = await fetch(`${srv.base}/api/demandes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ms-client-principal': principal(['RH']) },
      body: '{pas du json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
