import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
body{font-family:system-ui,sans-serif;max-width:60rem;margin:1rem auto;padding:0 1rem;color:#1a1a1a}
nav{margin-bottom:1rem}nav a{margin-right:1rem}
label{display:block;margin:.5rem 0}input,select,button{font:inherit;padding:.35rem}
input{width:100%;max-width:28rem;box-sizing:border-box}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:.4rem;text-align:left;vertical-align:top}
.msg{padding:.6rem;margin:.8rem 0;border:1px solid #888}.err{border-color:#b00020}.ok{border-color:#1b6e2d}
.msg.err.lic{border-width:3px;font-weight:600}
.warn{border-color:#b26a00}.msg.warn{border-width:3px;font-weight:600}
.mdp{font:1.6rem monospace;letter-spacing:.1em;padding:.6rem;border:2px solid #1a1a1a;display:inline-block;margin:.5rem 0}
`;

/** CSP stricte : un seul script inline autorisé (nonce), aucune ressource externe, pas de formulaire natif. */
export const withNonce: RequestHandler = (_req, res, next) => {
  const nonce = randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  res.set({
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    // Les pages d'activation affichent un mot de passe temporaire : rien ne doit être mis en cache.
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  });
  next();
};

export function page(title: string, body: string, nonce: string, script = ''): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body>
<nav><a href="/demande">Demande RH</a><a href="/activation">Activation RH</a><a href="/direction">Direction</a></nav>
<h1>${escapeHtml(title)}</h1>
<div id="msg" role="status"></div>
${body}
<script nonce="${nonce}">${COMMON}${script}</script>
</body>
</html>`;
}

/**
 * Helpers côté navigateur. Les données Entra sont toujours insérées avec textContent
 * (jamais innerHTML). Le mot de passe temporaire reste dans le DOM : ni URL, ni stockage navigateur.
 */
const COMMON = `
const $ = (id) => document.getElementById(id);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const kid of kids) e.append(kid);
  return e;
}
function say(text, kind, extra) {
  const m = $('msg'); m.replaceChildren();
  if (text) m.append(el('div', { class: 'msg ' + (kind || '') + (extra ? ' ' + extra : ''), text }));
}
async function api(method, path, body) {
  // Écriture en cours : boutons désactivés (double clic), réactivés à la réponse.
  const locked = method === 'GET' ? [] : [...document.querySelectorAll('button:not([disabled])')];
  locked.forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('application/json')) return { ok: false, status: res.status, data: { error: 'Session expirée ou réponse inattendue : rechargez la page.' } };
    return { ok: res.ok, status: res.status, data: await res.json() };
  } catch {
    return { ok: false, status: 0, data: { error: 'Réseau indisponible.' } };
  } finally {
    locked.forEach((b) => { b.disabled = false; });
  }
}
function describe(r) {
  const d = r.data || {};
  const fields = d.details ? ' (' + Object.entries(d.details).map(([k, v]) => k + ' : ' + v).join(' ; ') + ')' : '';
  const step = d.etape ? ' [étape : ' + d.etape + ']' : '';
  const why = d.raison ? ' [' + d.raison + ']' : '';
  return (d.error || 'Erreur ' + r.status) + fields + step + why;
}
`;

export const DEMANDE_SCRIPT = `
let timer;
$('q').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(search, 300);
});
async function search() {
  const q = $('q').value.trim();
  const list = $('results'); list.replaceChildren();
  if (q.length < 2) return;
  const r = await api('GET', '/api/annuaire?q=' + encodeURIComponent(q));
  if (!r.ok) return say(describe(r), 'err');
  if (r.data.length === 0) list.append(el('li', { text: 'Aucun résultat.' }));
  for (const u of r.data) {
    list.append(el('li', {}, el('button', { type: 'button', text: u.displayName + (u.mail ? ' (' + u.mail + ')' : ''), onclick: () => pick(u) })));
  }
}
function pick(u) {
  $('managerId').value = u.id;
  $('manager').textContent = u.displayName;
  $('results').replaceChildren();
}
$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  say('');
  const f = new FormData($('form'));
  const body = Object.fromEntries(['prenom', 'nom', 'dateArrivee', 'poste', 'service', 'managerId', 'typeContrat'].map((k) => [k, String(f.get(k) || '')]));
  const r = await api('POST', '/api/demandes', body);
  if (!r.ok && r.data && r.data.code === 'licence_indisponible') return say('Aucune licence disponible pour ce type de contrat : libérez ou commandez une licence, puis renvoyez la demande.', 'err', 'lic');
  if (!r.ok) return say(describe(r), 'err');
  if (r.data.avertissement === 'manager_non_affecte') {
    say('Demande enregistrée : identifiant ' + r.data.userPrincipalName + ', mais le manager n’a pas pu être affecté : posez-le dans Entra. Ne renvoyez pas la demande.', 'warn');
  } else {
    say('Demande enregistrée : identifiant ' + r.data.userPrincipalName + '. Elle attend la validation de la direction (visible chez elle d’ici une minute).', 'ok');
  }
  $('form').reset(); $('manager').textContent = 'aucun';
});
`;

export const DIRECTION_SCRIPT = `
async function load() {
  const body = $('rows'); body.replaceChildren();
  const r = await api('GET', '/api/demandes');
  if (!r.ok) return say(describe(r), 'err');
  if (r.data.tronque) say('Liste tronquée : seules les 100 premières demandes sont affichées.');
  if (r.data.demandes.length === 0) body.append(el('tr', {}, el('td', { colspan: 6, text: 'Aucune demande en attente.' })));
  for (const d of r.data.demandes) {
    const motif = el('input', { placeholder: 'Motif du refus', 'aria-label': 'Motif du refus' });
    body.append(el('tr', {},
      el('td', { text: d.nom }), el('td', { text: d.poste || '' }), el('td', { text: d.service || '' }),
      el('td', { text: d.manager ? d.manager.displayName : '' }), el('td', { text: d.dateArrivee || '' }),
      el('td', {},
        el('button', { type: 'button', text: 'Valider', onclick: () => act(d, 'valider', {}) }),
        el('div', {}, motif, el('button', { type: 'button', text: 'Refuser', onclick: () => act(d, 'refuser', { motif: motif.value }) })))));
  }
}
async function act(d, action, body) {
  say('');
  if (action === 'refuser' && !confirm('Refuser cette demande ? Le compte sera supprimé (récupérable 30 jours).')) return;
  const r = await api('POST', '/api/demandes/' + d.id + '/' + action, body);
  if (!r.ok && r.data && r.data.code === 'licence_indisponible') {
    return say('Aucune licence disponible : la demande de ' + d.nom + ' reste en attente. Libérez ou commandez une licence, puis validez à nouveau.', 'err', 'lic');
  }
  if (r.status === 202 && r.data && r.data.code === 'licence_en_cours') {
    return say(r.data.message + ' (demande de ' + d.nom + ', toujours en attente).', 'warn');
  }
  if (!r.ok) return say(describe(r), 'err');
  say(action === 'valider' ? 'Demande validée, licence attribuée, dossier SharePoint prêt.' : 'Demande refusée, compte supprimé.', 'ok');
  load();
}
load();
`;

export const ACTIVATION_SCRIPT = `
const MOTIFS = [
  ['code_perdu', 'Mot de passe perdu'],
  ['code_refuse', 'Mot de passe refusé'],
  ['autre', 'Autre'],
];
function showPassword(d, t) {
  const box = $('mdp'); box.replaceChildren();
  box.append(
    el('div', { class: 'msg ok' },
      el('p', { text: 'Mot de passe temporaire pour ' + d.nom + ' : à remettre en main propre. Il ne sera plus affiché.' }),
      el('div', { class: 'mdp', text: t.motDePasseTemporaire }),
      el('p', { text: 'À la première connexion (PC ou n’importe quel service Microsoft), la personne doit inscrire Microsoft Authenticator, puis changer ce mot de passe. S’il est refusé, réessayer dans une à deux minutes.' }),
      el('button', { type: 'button', text: 'Masquer', onclick: () => box.replaceChildren() })));
}
function etat(d) {
  const o = d.onboarding;
  if (!o) return '';
  if (o.verification) return 'Vérification impossible, réessayez';
  if (o.termine) return 'Onboarding terminé (finalisation en cours)';
  return 'Onboarding non terminé (mot de passe : ' + (o.motDePasse ? 'fait' : 'à faire') + ' ; Authenticator : ' + (o.authenticator ? 'fait' : 'à faire') + ')';
}
function cellule(d) {
  if (d.action === 'attendre') return el('td', { text: 'Pas avant la date d’arrivée' });
  if (d.action === 'activer') return el('td', {}, el('button', { type: 'button', text: 'Activer', onclick: () => activer(d) }));
  const motif = el('select', { 'aria-label': 'Motif de la régénération' }, ...MOTIFS.map(([v, l]) => el('option', { value: v, text: l })));
  return el('td', {}, motif, el('button', { type: 'button', text: 'Nouveau mot de passe', onclick: () => regenerer(d, motif.value) }));
}
async function load(finaliser) {
  const body = $('rows'); body.replaceChildren();
  const r = await api('GET', '/api/activations');
  if (!r.ok) return say(describe(r), 'err');
  if (r.data.tronque) say('Liste tronquée : seuls les 100 premiers comptes par statut sont affichés.');
  if (r.data.demandes.length === 0) body.append(el('tr', {}, el('td', { colspan: 7, text: 'Aucun compte à activer.' })));
  for (const d of r.data.demandes) {
    body.append(el('tr', {},
      el('td', { text: d.nom }), el('td', { text: d.poste || '' }), el('td', { text: d.service || '' }),
      el('td', { text: d.dateArrivee || '' }), el('td', { text: d.statut }), el('td', { text: etat(d) }), cellule(d)));
  }
  // La liste ne fait que lire : la finalisation est une écriture (POST), revérifiée par le serveur.
  if (!finaliser) return;
  const prets = r.data.demandes.filter((d) => d.onboarding && d.onboarding.termine);
  let faits = 0;
  for (const d of prets) { const t = await api('POST', '/api/demandes/' + d.id + '/terminer', {}); if (t.ok) faits++; }
  if (faits > 0) { await load(false); say(faits + ' onboarding' + (faits > 1 ? 's' : '') + ' terminé' + (faits > 1 ? 's' : '') + '.', 'ok'); }
}
function refus(r) {
  const d = r.data || {};
  if (r.status === 409 && d.raison === 'onboarding_termine') return 'Onboarding terminé : aucun nouveau mot de passe.';
  if (r.status === 409 && d.raison === 'deja_actif') return 'Compte déjà actif : utilisez « Nouveau mot de passe ».';
  return describe(r);
}
async function activer(d) {
  say(''); $('mdp').replaceChildren();
  const r = await api('POST', '/api/demandes/' + d.id + '/activer', {});
  if (!r.ok) return say(refus(r), 'err');
  say('Compte activé.', 'ok');
  showPassword(d, r.data);
  r.data.motDePasseTemporaire = '';
  load(false);
}
async function regenerer(d, motif) {
  say(''); $('mdp').replaceChildren();
  if (!confirm('Donner un nouveau mot de passe temporaire à ' + d.nom + ' ? Le mot de passe actuel ne fonctionnera plus.')) return;
  const r = await api('POST', '/api/demandes/' + d.id + '/regenerer', { motif });
  if (!r.ok) return say(refus(r), 'err');
  say('Nouveau mot de passe temporaire créé.', 'ok');
  showPassword(d, r.data);
  r.data.motDePasseTemporaire = '';
  load(false);
}
load(true);
`;
