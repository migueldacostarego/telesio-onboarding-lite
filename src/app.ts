import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { createApiRouter, type ApiDeps } from './routes/api';
import { createWebRouter } from './routes/web';

// Sur toutes les réponses, erreurs comprises (la CSP du front est posée par routes/web.ts). Pas d'includeSubDomains pour HSTS : le
// domaine est celui d'App Service, pas le nôtre.
const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  next();
};

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    // Pas d'objet d'erreur complet : une erreur Graph peut contenir des données personnelles.
    console.error('erreur interne', err?.name, err?.code);
  }
  res.status(status).json({ error: status === 500 ? 'Erreur interne' : 'Requête invalide' });
};

export interface AppOptions {
  /** Dossier du build du front (défaut : dist/web). */
  webDir?: string;
}

export function createApp(deps: ApiDeps, options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/', (_req, res) => res.redirect('/app/'));
  app.use('/app', createWebRouter(options.webDir));
  app.use('/api', createApiRouter(deps));
  app.use(errorHandler);
  return app;
}
