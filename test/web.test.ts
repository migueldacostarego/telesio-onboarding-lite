import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_WEB_DIR, NONCE_PLACEHOLDER, WEB_CSP, indexCsp } from '../src/routes/web';
import { listen, setup } from './helpers/ctx';

const INDEX = `<!doctype html><html lang="fr"><head><meta name="csp-nonce" content="${NONCE_PLACEHOLDER}" /><title>Telesio Onboarding</title></head><body><div id="root"></div><script type="module" src="/app/assets/index-abc123.js"></script></body></html>`;
/** Un index.html d'un build antérieur : sans marqueur de nonce. */
const INDEX_SANS_MARQUEUR = '<!doctype html><html lang="fr"><head><title>Telesio Onboarding</title></head><body><div id="root"></div></body></html>';

/** Le nonce porté par la meta d'une réponse index.html. */
const nonceDe = (html: string): string => /<meta name="csp-nonce" content="([^"]*)"/.exec(html)?.[1] ?? '';

describe('front React sous /app', () => {
  let root: string;
  let dir: string;
  let srv: Awaited<ReturnType<typeof listen>>;
  let empty: Awaited<ReturnType<typeof listen>>;
  let ancien: Awaited<ReturnType<typeof listen>>;
  const get = (p: string, s = srv) => fetch(`${s.base}${p}`);

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'telesio-web-'));
    dir = path.join(root, 'web');
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), INDEX);
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1);');
    fs.writeFileSync(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    srv = await listen(setup({}, { webDir: dir }).app);
    // Front non construit : le dossier n'existe pas.
    empty = await listen(setup({}, { webDir: path.join(root, 'absent') }).app);
    fs.mkdirSync(path.join(root, 'ancien'));
    fs.writeFileSync(path.join(root, 'ancien', 'index.html'), INDEX_SANS_MARQUEUR);
    ancien = await listen(setup({}, { webDir: path.join(root, 'ancien') }).app);
  });
  afterAll(async () => {
    await srv.close();
    await empty.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('dossier par défaut : web/ à côté de routes/ (dist/web une fois compilé)', () => {
    expect(DEFAULT_WEB_DIR).toBe(path.resolve(__dirname, '../src/web'));
  });

  const ROUTES = ['/app', '/app/', '/app/demande', '/app/direction/42', '/app/activation?x=1'];

  it('sert index.html sur /app, /app/ et les routes du front (repli), avec le nonce de la requête dans la meta', async () => {
    for (const p of ROUTES) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      const nonce = nonceDe(html);
      expect(nonce).not.toBe('');
      expect(nonce).not.toBe(NONCE_PLACEHOLDER);
      expect(html).toBe(INDEX.replace(NONCE_PLACEHOLDER, nonce));
      expect(html).not.toContain(NONCE_PLACEHOLDER);
    }
  });

  it('CSP de index.html : style-src \'self\' + le nonce de la meta, ni unsafe-inline ni unsafe-eval, aucun nonce pour les scripts', async () => {
    for (const p of ROUTES) {
      const res = await get(p);
      const nonce = nonceDe(await res.text());
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toBe(indexCsp(nonce));
      expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
      expect(csp).toContain("script-src 'self';");
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|data:|\*/);
      // Le nonce n'apparaît que dans style-src.
      expect(csp.split(nonce)).toHaveLength(2);
    }
  });

  it('nonce aléatoire par requête : 128 bits en base64, jamais deux fois le même', async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 25; i++) nonces.add(nonceDe(await (await get('/app/')).text()));
    expect(nonces.size).toBe(25);
    for (const n of nonces) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(n, 'base64')).toHaveLength(16);
    }
  });

  it('jamais en cache : no-store, pas d’ETag, aucune réponse 304 même à une requête conditionnelle', async () => {
    for (const p of ROUTES) {
      const res = await get(p);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('pragma')).toBe('no-cache');
      expect(res.headers.get('etag')).toBeNull();
      expect(res.headers.get('last-modified')).toBeNull();
    }
    const conditionnelle = await fetch(`${srv.base}/app/`, { headers: { 'if-none-match': '*', 'if-modified-since': new Date(Date.now() + 86_400_000).toUTCString() } });
    expect(conditionnelle.status).toBe(200);
  });

  it('HEAD : mêmes en-têtes (CSP avec nonce, no-store), sans corps', async () => {
    const res = await fetch(`${srv.base}/app/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9+/]{22}=='/);
    expect(await res.text()).toBe('');
  });

  it('index.html demandé explicitement (toutes casses) : même traitement, jamais le fichier brut', async () => {
    for (const p of ['/app/index.html', '/app/INDEX.HTML', '/app/Index.html?x=1']) {
      const res = await get(p);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain(NONCE_PLACEHOLDER);
      expect(res.headers.get('content-security-policy')).toBe(indexCsp(nonceDe(html)));
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('relu à chaque requête : un nouveau build est servi tout de suite', async () => {
    const fichier = path.join(dir, 'index.html');
    fs.writeFileSync(fichier, INDEX.replace('Telesio Onboarding', 'Telesio Onboarding (build 2)'));
    try {
      expect(await (await get('/app/')).text()).toContain('(build 2)');
    } finally {
      fs.writeFileSync(fichier, INDEX);
    }
    expect(await (await get('/app/')).text()).not.toContain('(build 2)');
  });

  it('index.html d’un build sans marqueur : servi tel quel, avec la CSP à nonce', async () => {
    const res = await get('/app/', ancien);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX_SANS_MARQUEUR);
    expect(res.headers.get('content-security-policy')).toMatch(/style-src 'self' 'nonce-/);
  });

  it('fichiers statiques et erreurs : CSP stricte sans nonce (aucun style à autoriser)', async () => {
    for (const p of ['/app/assets/index-abc123.js', '/app/favicon.svg', '/app/assets/absent.js']) {
      const csp = (await get(p)).headers.get('content-security-policy') ?? '';
      expect(csp).toBe(WEB_CSP);
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self';");
      expect(csp).not.toMatch(/nonce-|unsafe-inline|unsafe-eval|https?:|data:/);
    }
  });

  it('assets nommés par empreinte : cache long et privé ; autres fichiers : no-store', async () => {
    const asset = await get('/app/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const icon = await get('/app/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('cache-control')).toBe('no-store');
  });

  it('fichier absent : 404, jamais index.html à sa place', async () => {
    for (const p of ['/app/assets/absent.js', '/app/absent.css', '/app/favicon.ico']) {
      const res = await get(p);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('<div id="root">');
    }
  });

  it('seules les lectures retombent sur index.html', async () => {
    const res = await fetch(`${srv.base}/app/nouvelle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(404);
  });

  it('ne sort pas du dossier du build', async () => {
    fs.writeFileSync(path.join(root, 'secret.json'), '{"secret":1}');
    for (const p of ['/app/%2e%2e/secret.json', '/app/..%2fsecret.json', '/app/%2e%2e%2fsecret.json']) {
      const res = await get(p);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain('"secret"');
    }
  });

  it('front non construit : 503 explicite sur les routes, sans planter', async () => {
    const res = await get('/app/', empty);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-security-policy')).toBe(WEB_CSP);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('/ redirige vers /app/ ; les anciennes pages n’existent plus ; /api reste protégée', async () => {
    const racine = await fetch(`${srv.base}/`, { redirect: 'manual' });
    expect(racine.status).toBe(302);
    expect(racine.headers.get('location')).toBe('/app/');
    for (const ancienne of ['/demande', '/direction', '/activation']) expect((await get(ancienne)).status).toBe(404);
    for (const retiree of ['/api/licences', '/api/activations']) expect((await get(retiree)).status).toBe(404);
    expect((await get('/api/suivi')).status).toBe(401);
    expect((await get('/healthz')).status).toBe(200);
  });
});
