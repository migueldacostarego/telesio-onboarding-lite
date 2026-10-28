import express, { Router, type RequestHandler } from 'express';
import type { Audit } from '../audit';
import { todayIn } from '../dates';
import { requireDirection, requireRole, type Principal } from '../auth';
import type { ReadyConfig } from '../config';
import { createDemande, ServiceError } from '../demandes';
import { activerDemande, listActivations } from '../activation';
import { listDemandes, refuserDemande, validerDemande } from '../direction';
import { listLicences, SkuAvailabilityCache } from '../licence';
import { DirectoryError, type Directory } from '../directory';
import type { Library } from '../sharepoint';
import { GUID_RE, validateDemande, validateMotif } from '../validation';

export interface ApiDeps {
  config: ReadyConfig;
  directory: Directory;
  audit: Audit;
  /** Absent si SharePoint n'est pas configuré : valider répond alors 503. */
  library?: Library;
  now?: () => Date;
  managerRetryDelaysMs?: number[];
  /** Attentes entre deux lectures de l'état de licence après l'ajout au groupe. */
  licensePollDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

type Res = express.Response;
const fail = (res: Res, err: unknown) => {
  if (err instanceof ServiceError) {
    res.status(err.status).json(err.body);
    return;
  }
  throw err;
};

// Les écritures n'acceptent que du JSON : un POST de formulaire cross-site (CSRF) est refusé avant tout traitement.
const jsonOnly: RequestHandler = (req, res, next) => {
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'Content-Type application/json requis' });
    return;
  }
  next();
};

// inflate:false : les corps compressés sont refusés (415). Atténue l'avis body-parser < 2.4.0
// (DoS sur corps compressé) tant que la 2.4.0 a moins de 7 jours ; aucun client légitime n'en envoie.
const json = express.json({ limit: '16kb', inflate: false });

export function createApiRouter(deps: ApiDeps): Router {
  const { config, directory, audit } = deps;
  const now = deps.now ?? (() => new Date());
  // Affichage du formulaire RH uniquement : création de demande et validation direction relisent /subscribedSkus en direct.
  const skuCache = new SkuAvailabilityCache(() => now().getTime());
  const api = Router();
  // Aucune réponse de l'API n'est mise en cache (TAP, listes nominatives), erreurs comprises.
  api.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    next();
  });
  const rh = requireRole(config.rhRole, { trustHeaders: config.trustAuthHeaders, audit });
  const direction = requireDirection(config.direction, directory, { trustHeaders: config.trustAuthHeaders, audit });
  const actor = (res: express.Response) => (res.locals.principal as Principal).id;

  // GET /api/annuaire?q= : recherche du manager (Entra, $search sur displayName/mail)
  api.get('/annuaire', rh, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.replace(/\s+/g, ' ').trim() : '';
    if (q.length < 2 || q.length > 64) {
      res.status(400).json({ error: 'Entrée invalide', details: { q: '2 à 64 caractères requis' } });
      return;
    }
    try {
      const users = await directory.search(q);
      // La recherche elle-même n'est pas tracée (noms) : seulement sa longueur et le nombre de résultats.
      audit.track({ action: 'annuaire.recherche', actor: actor(res), outcome: 'ok', longueur: q.length, resultats: users.length });
      res.json(users);
    } catch (err) {
      const e = err instanceof DirectoryError ? err : undefined;
      audit.track({ action: 'annuaire.recherche', actor: actor(res), outcome: 'erreur', http: e?.statusCode, code: e?.code });
      res.status(502).json({ error: 'Le service d’annuaire est indisponible' });
    }
  });

  const noLicenses = (res: Res): boolean => {
    if (config.licenses.length > 0) return false;
    res.status(503).json({ error: 'Licences non configurées (LICENSES)' });
    return true;
  };

  // GET /api/licences : licences proposées à RH, avec le nombre d'unités libres
  api.get('/licences', rh, async (_req, res) => {
    if (noLicenses(res)) return;
    try {
      res.json(await listLicences(deps, actor(res), skuCache));
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/demandes : crée le compte Entra désactivé (statutOnboarding=EnAttente)
  api.post('/demandes', rh, jsonOnly, json, async (req, res) => {
    if (noLicenses(res)) return;
    const v = validateDemande(req.body, todayIn(config.timeZone, now()), config.licenses);
    if (!v.ok) {
      audit.track({ action: 'demande.rejetee', actor: actor(res), outcome: 'refuse', champs: Object.keys(v.details).join(',') });
      res.status(400).json({ error: 'Entrée invalide', details: v.details });
      return;
    }
    try {
      const created = await createDemande(deps, actor(res), v.value);
      res.status(201).json(created);
    } catch (err) {
      // Le formulaire recharge la liste après ce refus : elle doit refléter l'état réel.
      if (err instanceof ServiceError && err.body.code === 'licence_indisponible') skuCache.invalidate();
      fail(res, err);
    }
  });

  // Direction : demandes en attente
  api.get('/demandes', direction, async (_req, res) => {
    try {
      res.json(await listDemandes(deps, actor(res)));
    } catch (err) {
      fail(res, err);
    }
  });

  // Les actions Direction passent par le même contrôle d'id et n'acceptent que du JSON (CSRF).
  const badId: RequestHandler = (req, res, next) => {
    if (!GUID_RE.test(String(req.params.id))) {
      res.status(400).json({ error: 'Entrée invalide', details: { id: 'objectId Entra (GUID) requis' } });
      return;
    }
    next();
  };

  api.post('/demandes/:id/valider', direction, badId, jsonOnly, json, async (req, res) => {
    try {
      res.json(await validerDemande(deps, actor(res), String(req.params.id)));
    } catch (err) {
      fail(res, err);
    } finally {
      // Une validation consomme (ou constate l'absence de) une unité : la liste RH ne doit plus servir l'ancien compte.
      skuCache.invalidate();
    }
  });

  api.post('/demandes/:id/refuser', direction, badId, jsonOnly, json, async (req, res) => {
    const m = validateMotif(req.body);
    if (!m.ok) {
      audit.track({ action: 'demande.rejetee', actor: actor(res), outcome: 'refuse', champs: 'motif' });
      res.status(400).json({ error: 'Entrée invalide', details: m.details });
      return;
    }
    try {
      res.json(await refuserDemande(deps, actor(res), String(req.params.id), m.motif));
    } catch (err) {
      fail(res, err);
    }
  });

  // RH : comptes Validé à activer (+ Actif récents pour « Régénérer »)
  api.get('/activations', rh, async (_req, res) => {
    try {
      res.json(await listActivations(deps, actor(res), now()));
    } catch (err) {
      fail(res, err);
    }
  });

  // RH, jour J : active le compte et renvoie le TAP, visible une seule fois (jamais tracé).
  api.post('/demandes/:id/activer', rh, badId, jsonOnly, json, async (req, res) => {
    try {
      res.json(await activerDemande(deps, actor(res), String(req.params.id), now()));
    } catch (err) {
      fail(res, err);
    }
  });
  return api;
}
