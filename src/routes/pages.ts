import { Router, type Response } from 'express';
import {
  ACTIVATION_SCRIPT,
  DEMANDE_SCRIPT,
  DIRECTION_SCRIPT,
  page,
  withNonce,
} from '../views/layout';

/**
 * Pages-coquilles : aucune donnée n'est servie ici. Les données passent par /api (rôles vérifiés),
 * et Easy Auth protège déjà l'ensemble du site.
 */
export const pages = Router();
pages.use(withNonce);

const nonce = (res: Response) => String(res.locals.nonce);

pages.get('/', (_req, res) => res.redirect('/demande'));

pages.get('/demande', (_req, res) => {
  res.send(
    page(
      'Demande d’onboarding (RH)',
      `<form id="form">
  <label>Prénom <input name="prenom" required maxlength="64" autocomplete="off"></label>
  <label>Nom <input name="nom" required maxlength="64" autocomplete="off"></label>
  <label>Date d’arrivée <input type="date" name="dateArrivee" required></label>
  <label>Poste <input name="poste" required maxlength="128" autocomplete="off"></label>
  <label>Service <input name="service" required maxlength="64" autocomplete="off"></label>
  <label>Manager : rechercher par nom ou email <input id="q" type="search" autocomplete="off" aria-describedby="manager"></label>
  <ul id="results"></ul>
  <p>Manager choisi : <strong id="manager">aucun</strong></p>
  <input type="hidden" id="managerId" name="managerId" required>
  <label>Licence <select id="licence" name="licence" required><option value="">Chargement…</option></select></label>
  <button type="submit">Envoyer pour validation</button>
</form>`,
      nonce(res),
      DEMANDE_SCRIPT,
    ),
  );
});

pages.get('/direction', (_req, res) => {
  res.send(
    page(
      'Demandes en attente (direction)',
      `<table>
  <thead><tr><th>Nom</th><th>Poste</th><th>Service</th><th>Manager</th><th>Arrivée</th><th>Décision</th></tr></thead>
  <tbody id="rows"></tbody>
</table>`,
      nonce(res),
      DIRECTION_SCRIPT,
    ),
  );
});

pages.get('/activation', (_req, res) => {
  res.send(
    page(
      'Activation des comptes (RH)',
      `<div id="tap"></div>
<table>
  <thead><tr><th>Nom</th><th>Poste</th><th>Service</th><th>Arrivée</th><th>Statut</th><th>Action</th></tr></thead>
  <tbody id="rows"></tbody>
</table>`,
      nonce(res),
      ACTIVATION_SCRIPT,
    ),
  );
});
