import fs from 'node:fs';
import path from 'node:path';
import express, { Router, type RequestHandler } from 'express';

/**
 * Front React (web/), servi en statique sous /app. Le build Vite sort dans dist/web.
 *
 * CSP stricte, sans nonce ni 'unsafe-inline' : le build ne contient aucun script ni style inline
 * (les pages-coquilles de pages.ts, elles, gardent leur propre CSP). Pas de CDN : polices système.
 */
export const WEB_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Une fois compilé, dist/routes/web.js sert dist/web (sortie du build Vite). */
export const DEFAULT_WEB_DIR = path.join(__dirname, '..', 'web');

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set('Content-Security-Policy', WEB_CSP);
  next();
};

export function createWebRouter(dir: string = DEFAULT_WEB_DIR): Router {
  const router = Router();
  const indexFile = path.join(dir, 'index.html');
  router.use(securityHeaders);

  // Fichiers du build (assets/ nommés par empreinte : cache long, privé car derrière Easy Auth).
  router.use(
    express.static(dir, {
      index: false,
      fallthrough: true,
      setHeaders: (res, file) => {
        res.set(
          'Cache-Control',
          file.includes(`${path.sep}assets${path.sep}`) ? 'private, max-age=31536000, immutable' : 'no-store',
        );
      },
    }),
  );

  // Repli sur index.html pour les routes du front (GET/HEAD). Un chemin avec extension est un
  // fichier : s'il n'existe pas, 404 (jamais du HTML à la place d'un script ou d'une feuille de style).
  router.use((req, res) => {
    const isRoute = (req.method === 'GET' || req.method === 'HEAD') && path.extname(req.path) === '';
    if (!isRoute) {
      res.status(404).type('text/plain').send('Introuvable');
      return;
    }
    if (!fs.existsSync(indexFile)) {
      res.status(503).type('text/plain').send('Front non construit (npm run build)');
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(indexFile);
  });
  return router;
}
