import express, { type ErrorRequestHandler } from 'express';
import { createApiRouter, type ApiDeps } from './routes/api';
import { pages } from './routes/pages';

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    // Pas d'objet d'erreur complet : une erreur Graph peut contenir des données personnelles.
    console.error('erreur interne', err?.name, err?.code);
  }
  res.status(status).json({ error: status === 500 ? 'Erreur interne' : 'Requête invalide' });
};

export function createApp(deps: ApiDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  // Les formulaires HTML ne servent que les pages ; l'API n'accepte que du JSON.
  app.use(express.urlencoded({ extended: false, inflate: false }), pages);
  app.use('/api', createApiRouter(deps));
  app.use(errorHandler);
  return app;
}
