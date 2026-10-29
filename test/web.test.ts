import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_WEB_DIR, WEB_CSP } from '../src/routes/web';
import { listen, setup } from './helpers/ctx';

const INDEX = '<!doctype html><html lang="fr"><head><title>Telesio Onboarding</title></head><body><div id="root"></div><script type="module" src="/app/assets/index-abc123.js"></script></body></html>';

describe('front React sous /app', () => {
  let root: string;
  let dir: string;
  let srv: Awaited<ReturnType<typeof listen>>;
  let empty: Awaited<ReturnType<typeof listen>>;
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
  });
  afterAll(async () => {
    await srv.close();
    await empty.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('dossier par défaut : web/ à côté de routes/ (dist/web une fois compilé)', () => {
    expect(DEFAULT_WEB_DIR).toBe(path.resolve(__dirname, '../src/web'));
  });

  it('sert index.html sur /app et /app/, sans mise en cache', async () => {
    for (const p of ['/app', '/app/']) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe(INDEX);
    }
  });

  it('repli sur index.html pour les routes du front, profondes comprises', async () => {
    for (const p of ['/app/demande', '/app/direction/42', '/app/activation?x=1']) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(INDEX);
    }
  });

  it('CSP stricte : self uniquement, ni nonce ni unsafe-inline ni CDN', async () => {
    for (const p of ['/app/', '/app/demande', '/app/assets/index-abc123.js', '/app/assets/absent.js']) {
      const csp = (await get(p)).headers.get('content-security-policy') ?? '';
      expect(csp).toBe(WEB_CSP);
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
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
    const res = await fetch(`${srv.base}/app/demande`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
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
  });

  it('les pages actuelles gardent leur CSP à nonce, et /api reste protégée', async () => {
    const res = await get('/demande');
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'nonce-/);
    expect(csp).not.toBe(WEB_CSP);
    expect((await get('/direction')).status).toBe(200);
    expect((await get('/activation')).status).toBe(200);
    expect((await get('/api/licences')).status).toBe(401);
    expect((await get('/healthz')).status).toBe(200);
  });
});
