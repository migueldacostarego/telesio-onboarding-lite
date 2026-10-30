import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, type ApiErrorKind } from '@/lib/api';

const reply = (status: number, body: unknown, type = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });

const mockFetch = (res: Response | Error) => {
  const fn = vi.fn(() => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)));
  vi.stubGlobal('fetch', fn);
  return fn;
};

const failure = async (p: Promise<unknown>): Promise<ApiError> => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
};

afterEach(() => vi.unstubAllGlobals());

describe('client API', () => {
  it('renvoie le corps d’un succès, tableau compris', async () => {
    mockFetch(reply(200, [{ id: 'a', displayName: 'Camille' }]));
    expect(await api.get('/api/annuaire?q=ca')).toEqual({ kind: 'ok', status: 200, data: [{ id: 'a', displayName: 'Camille' }] });
  });

  it('traite 201 comme un succès et garde l’avertissement', async () => {
    mockFetch(reply(201, { id: 'a', statut: 'EnAttente', avertissement: 'manager_non_affecte' }));
    const r = await api.post<{ avertissement?: string }>('/api/demandes', { nom: 'x' });
    expect(r.kind).toBe('ok');
    expect(r.data).toMatchObject({ avertissement: 'manager_non_affecte' });
  });

  it('distingue le 202 d’un succès et d’une erreur, avec le code du back', async () => {
    mockFetch(reply(202, { message: 'Licence en cours', code: 'licence_en_cours', etape: 'licence_verification' }));
    expect(await api.post('/api/demandes/x/valider')).toEqual({
      kind: 'en_cours',
      status: 202,
      data: { message: 'Licence en cours', code: 'licence_en_cours', etape: 'licence_verification' },
    });
  });

  it.each<[number, ApiErrorKind]>([
    [400, 'invalide'],
    [403, 'non_autorise'],
    [404, 'introuvable'],
    [409, 'conflit'],
    [415, 'invalide'],
    [502, 'amont'],
    [503, 'indisponible'],
    [500, 'serveur'],
  ])('classe le statut %i en %s', async (status, kind) => {
    mockFetch(reply(status, { error: 'Message du back' }));
    const err = await failure(api.get('/api/x'));
    expect(err).toMatchObject({ status, kind, message: 'Message du back' });
  });

  it('409 : renvoie code et raison du back', async () => {
    mockFetch(reply(409, { error: 'Aucune licence disponible', code: 'licence_indisponible', raison: 'statut' }));
    expect(await failure(api.post('/api/demandes', {}))).toMatchObject({ kind: 'conflit', code: 'licence_indisponible', raison: 'statut' });
  });

  it('502 : renvoie l’étape et l’id du compte éventuellement créé', async () => {
    mockFetch(reply(502, { error: 'Échec', etape: 'dossier_sharepoint', id: 'abc' }));
    expect(await failure(api.post('/api/demandes/x/valider'))).toMatchObject({ kind: 'amont', etape: 'dossier_sharepoint', id: 'abc' });
  });

  it('400 : renvoie le détail par champ, sans valeur non textuelle', async () => {
    mockFetch(reply(400, { error: 'Entrée invalide', details: { nom: 'requis', n: 3 } }));
    expect((await failure(api.post('/api/demandes', {}))).details).toEqual({ nom: 'requis' });
  });

  it('503 : kind indisponible', async () => {
    mockFetch(reply(503, { error: 'Licences non configurées (LICENSES)' }));
    expect(await failure(api.get('/api/suivi'))).toMatchObject({ kind: 'indisponible', status: 503 });
  });

  it('réseau coupé : kind reseau, statut 0', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    expect(await failure(api.get('/api/x'))).toMatchObject({ kind: 'reseau', status: 0 });
  });

  it('page HTML en 200 (Easy Auth) : kind session', async () => {
    mockFetch(reply(200, '<html>Connexion</html>', 'text/html'));
    expect(await failure(api.get('/api/x'))).toMatchObject({ kind: 'session' });
  });

  it('redirection non suivie (session expirée) : kind session', async () => {
    const res = new Response(null);
    Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
    mockFetch(res);
    expect(await failure(api.get('/api/x'))).toMatchObject({ kind: 'session', status: 0 });
  });

  it('page HTML en 502 (passerelle) : garde le classement par statut', async () => {
    mockFetch(reply(502, '<html>Bad gateway</html>', 'text/html'));
    expect(await failure(api.get('/api/x'))).toMatchObject({ kind: 'amont', status: 502 });
  });

  it('écriture : Content-Type JSON et corps {} par défaut ; lecture sans corps', async () => {
    const post = mockFetch(reply(200, {}));
    await api.post('/api/demandes/x/valider');
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/demandes/x/valider');
    expect(init).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin', redirect: 'manual' });
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const get = mockFetch(reply(200, {}));
    await api.get('/api/suivi');
    const [, getInit] = get.mock.calls[0] as unknown as [string, RequestInit];
    expect(getInit.body).toBeUndefined();
    expect(getInit.headers).not.toHaveProperty('Content-Type');
  });
});
