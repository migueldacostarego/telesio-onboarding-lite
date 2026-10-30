import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router, type RequestHandler, type Response } from 'express';

/**
 * Front React (web/), servi sous /app. Le build Vite sort dans dist/web.
 *
 * CSP stricte, sans 'unsafe-inline' ni CDN, polices système. Scripts : 'self' seulement (le build n'a aucun script inline).
 * Styles : 'self', plus un **nonce aléatoire par requête** sur index.html seulement : les composants modaux de Radix
 * (dialog, sheet, menu modal) verrouillent le défilement en créant un <style> à l'exécution, que le front marque avec ce nonce
 * (meta `csp-nonce`, voir web/src/lib/nonce.ts). Le nonce ne vaut que pour les styles : il n'autorise aucun script.
 */
const buildCsp = (styleSrc: string): string =>
  [
    "default-src 'none'",
    "script-src 'self'",
    `style-src ${styleSrc}`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

/** CSP des fichiers statiques et des réponses d'erreur : pas de nonce (aucun style à autoriser). */
export const WEB_CSP = buildCsp("'self'");

/** CSP de index.html : même politique, avec le nonce de cette requête pour les styles. */
export const indexCsp = (nonce: string): string => buildCsp(`'self' 'nonce-${nonce}'`);

/** Marqueur de web/index.html (meta csp-nonce), remplacé par le nonce de la requête. */
export const NONCE_PLACEHOLDER = '__CSP_NONCE__';

/** 128 bits, base64 : imprévisible, jamais réutilisé d'une requête à l'autre. */
const newNonce = (): string => randomBytes(16).toString('base64');

/** Une fois compilé, dist/routes/web.js sert dist/web (sortie du build Vite). */
export const DEFAULT_WEB_DIR = path.join(__dirname, '..', 'web');

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const;

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set('Content-Security-Policy', WEB_CSP);
  next();
};

export function createWebRouter(dir: string = DEFAULT_WEB_DIR): Router {
  const router = Router();
  const indexFile = path.join(dir, 'index.html');
  router.use(securityHeaders);

  /**
   * index.html, lu à chaque requête, avec un nonce neuf dans l'en-tête CSP et dans la meta. Jamais en cache (no-store) :
   * ni navigateur ni proxy ne doivent rejouer un nonce. `end` et non `send` : pas d'ETag, donc aucune réponse 304 possible.
   */
  const envoyerIndex = async (res: Response): Promise<void> => {
    let html: string;
    try {
      html = await fs.promises.readFile(indexFile, 'utf8');
    } catch {
      res.status(503).set(NO_STORE).type('text/plain').send('Front non construit (npm run build)');
      return;
    }
    const nonce = newNonce();
    res
      .status(200)
      .set({ ...NO_STORE, 'Content-Security-Policy': indexCsp(nonce) })
      .type('html')
      .end(html.replaceAll(NONCE_PLACEHOLDER, nonce));
  };

  // index.html explicite, quelle que soit la casse : jamais servi tel quel par express.static (ni nonce, ni marqueur remplacé).
  router.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.path.toLowerCase() === '/index.html') {
      envoyerIndex(res).catch(next);
      return;
    }
    next();
  });

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
  router.use((req, res, next) => {
    const isRoute = (req.method === 'GET' || req.method === 'HEAD') && path.extname(req.path) === '';
    if (!isRoute) {
      res.status(404).type('text/plain').send('Introuvable');
      return;
    }
    envoyerIndex(res).catch(next);
  });
  return router;
}
