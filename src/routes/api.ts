import express, { Router, type RequestHandler } from 'express';
import type { Audit } from '../audit';
import { todayIn } from '../dates';
import { droitsDe, requireAuthenticated, requireDroit, type Principal } from '../auth';
import type { ReadyConfig } from '../config';
import { createDemande, ServiceError } from '../demandes';
import { activerDemande, listActivations, regenererMotDePasse, terminerOnboarding } from '../activation';
import { listSuivi } from '../suivi';
import { listDemandes, refuserDemande, reprendreDossier, validerDemande } from '../direction';
import { listLicences, SkuAvailabilityCache } from '../licence';
import { DirectoryError, type Directory } from '../directory';
import { KeyedLock } from '../lock';
import type { Library } from '../sharepoint';
import { GUID_RE, validateDemande, validateMotif, validateRegeneration } from '../validation';

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
  /** Verrou par compte, partagé avec la tâche de terminaison (même instance). Défaut : un verrou propre à ce routeur. */
  lock?: KeyedLock;
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
  // Aucune réponse de l'API n'est mise en cache (mot de passe temporaire, listes nominatives), erreurs comprises.
  api.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    next();
  });
  const authenticated = requireAuthenticated({ trustHeaders: config.trustAuthHeaders, audit });
  // Droits de droitsDe (ceux de GET /api/moi) : l'interface et l'API décident d'après le même calcul.
  const guardOpts = { trustHeaders: config.trustAuthHeaders, audit };
  const acces = requireDroit('acces', config, guardOpts);
  const creer = requireDroit('creer', config, guardOpts);
  const approuver = requireDroit('approuver', config, guardOpts);
  const activer = requireDroit('activer', config, guardOpts);
  const actor = (res: express.Response) => (res.locals.principal as Principal).id;
  // Double clic : une action à la fois par compte (et une création à la fois par personne RH).
  const lock = deps.lock ?? new KeyedLock();
  const key = (req: express.Request) => String(req.params.id).toLowerCase();

  // GET /api/moi : qui est connecté, ses rôles et ses droits (calculés ici d'après RH_ROLE et DIRECTION_ROLE), lu dans l'identité Easy Auth (aucun appel Graph, jamais mis en cache).
  api.get('/moi', authenticated, (_req, res) => {
    const { name, email, roles } = res.locals.principal as Principal;
    const uniques = [...new Set(roles)];
    res.json({ nom: name ?? email ?? '', email: email ?? null, roles: uniques, droits: droitsDe(uniques, config) });
  });

  // GET /api/annuaire?q= : recherche du manager (Entra, $search sur displayName/mail)
  api.get('/annuaire', creer, async (req, res) => {
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
  api.get('/licences', creer, async (_req, res) => {
    if (noLicenses(res)) return;
    try {
      res.json(await listLicences(deps, actor(res), skuCache));
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /api/demandes : crée le compte Entra désactivé (statutOnboarding=EnAttente)
  api.post('/demandes', creer, jsonOnly, json, async (req, res) => {
    if (noLicenses(res)) return;
    const v = validateDemande(req.body, todayIn(config.timeZone, now()), config.licenses);
    if (!v.ok) {
      audit.track({ action: 'demande.rejetee', actor: actor(res), outcome: 'refuse', champs: Object.keys(v.details).join(',') });
      res.status(400).json({ error: 'Entrée invalide', details: v.details });
      return;
    }
    try {
      const created = await lock.run(`creation:${actor(res)}`, () => createDemande(deps, actor(res), v.value));
      res.status(201).json(created);
    } catch (err) {
      // Le formulaire recharge la liste après ce refus : elle doit refléter l'état réel.
      if (err instanceof ServiceError && err.body.code === 'licence_indisponible') skuCache.invalidate();
      fail(res, err);
    }
  });

  // Droit approuver : demandes en attente
  api.get('/demandes', approuver, async (_req, res) => {
    try {
      res.json(await listDemandes(deps, actor(res)));
    } catch (err) {
      fail(res, err);
    }
  });

  // Valider et refuser (droit approuver) passent par le même contrôle d'id et n'acceptent que du JSON (CSRF).
  const badId: RequestHandler = (req, res, next) => {
    if (!GUID_RE.test(String(req.params.id))) {
      res.status(400).json({ error: 'Entrée invalide', details: { id: 'objectId Entra (GUID) requis' } });
      return;
    }
    next();
  };

  api.post('/demandes/:id/valider', approuver, badId, jsonOnly, json, async (req, res) => {
    try {
      res.json(await lock.run(key(req), () => validerDemande(deps, actor(res), String(req.params.id))));
    } catch (err) {
      fail(res, err);
    } finally {
      // Une validation consomme (ou constate l'absence de) une unité : la liste RH ne doit plus servir l'ancien compte.
      skuCache.invalidate();
    }
  });

  // Direction : recrée le dossier SharePoint manquant d'un compte Validé (après un 502), sans refaire la licence ni le groupe.
  api.post('/demandes/:id/reprendre', approuver, badId, jsonOnly, json, async (req, res) => {
    try {
      res.json(await lock.run(key(req), () => reprendreDossier(deps, actor(res), String(req.params.id))));
    } catch (err) {
      fail(res, err);
    }
  });

  api.post('/demandes/:id/refuser', approuver, badId, jsonOnly, json, async (req, res) => {
    const m = validateMotif(req.body);
    if (!m.ok) {
      audit.track({ action: 'demande.rejetee', actor: actor(res), outcome: 'refuse', champs: 'motif' });
      res.status(400).json({ error: 'Entrée invalide', details: m.details });
      return;
    }
    try {
      res.json(await lock.run(key(req), () => refuserDemande(deps, actor(res), String(req.params.id), m.motif)));
    } catch (err) {
      fail(res, err);
    }
  });

  // Droit activer : comptes Validé à activer, et comptes Actif avec l'état de leur onboarding (lecture seule)
  api.get('/activations', activer, async (_req, res) => {
    try {
      res.json(await listActivations(deps, actor(res), now()));
    } catch (err) {
      fail(res, err);
    }
  });

  // Toute personne qui a accès : suivi des demandes (EnAttente, Validé, Actif, Terminé récents), lecture seule, avec les actions
  // proposées à la personne connectée selon ses droits.
  api.get('/suivi', acces, async (_req, res) => {
    try {
      const { id, roles } = res.locals.principal as Principal;
      res.json(await listSuivi(deps, id, now(), droitsDe(roles, config)));
    } catch (err) {
      fail(res, err);
    }
  });

  // Droit activer, jour J : active le compte et renvoie le mot de passe temporaire, visible une seule fois (jamais tracé).
  api.post('/demandes/:id/activer', activer, badId, jsonOnly, json, async (req, res) => {
    try {
      res.json(await lock.run(key(req), () => activerDemande(deps, actor(res), String(req.params.id), now())));
    } catch (err) {
      fail(res, err);
    }
  });

  // Droit activer : nouveau mot de passe temporaire, avec un motif parmi des codes fixes ; interdit une fois l'onboarding Terminé.
  api.post('/demandes/:id/regenerer', activer, badId, jsonOnly, json, async (req, res) => {
    const m = validateRegeneration(req.body);
    if (!m.ok) {
      res.status(400).json({ error: 'Entrée invalide', details: m.details });
      return;
    }
    try {
      res.json(await lock.run(key(req), () => regenererMotDePasse(deps, actor(res), String(req.params.id), m.motif, now())));
    } catch (err) {
      fail(res, err);
    }
  });

  // Droit activer : finalise l'onboarding (retrait du groupe des arrivants, statut Terminé) si les conditions sont réunies.
  api.post('/demandes/:id/terminer', activer, badId, jsonOnly, json, async (req, res) => {
    try {
      res.json(await lock.run(key(req), () => terminerOnboarding(deps, actor(res), String(req.params.id))));
    } catch (err) {
      fail(res, err);
    }
  });
  return api;
}
