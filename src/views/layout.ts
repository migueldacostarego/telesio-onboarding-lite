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
.tap{font:1.6rem monospace;letter-spacing:.1em;padding:.6rem;border:2px solid #1a1a1a;display:inline-block;margin:.5rem 0}
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
    // Les pages d'activation affichent un TAP : rien ne doit être mis en cache.
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
 * (jamais innerHTML). Le TAP reste dans le DOM : ni URL, ni stockage navigateur.
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
async function loadLicences() {
  const r = await api('GET', '/api/licences');
  if (!r.ok) return say(describe(r), 'err');
  const sel = $('licence');
  sel.replaceChildren(el('option', { value: '', text: 'Choisir une licence' }));
  for (const l of r.data.licences) {
    const text = l.libelle + ' : ' + (l.disponibles > 0 ? l.disponibles + ' disponible' + (l.disponibles > 1 ? 's' : '') : 'aucune disponible');
    const props = { value: l.skuId, text };
    if (l.disponibles === 0) props.disabled = '';
    sel.append(el('option', props));
  }
}
loadLicences();
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
  const body = Object.fromEntries(['prenom', 'nom', 'dateArrivee', 'poste', 'service', 'managerId', 'licence'].map((k) => [k, String(f.get(k) || '')]));
  const r = await api('POST', '/api/demandes', body);
  if (!r.ok && r.data && r.data.code === 'licence_indisponible') { loadLicences(); return say('Aucune licence disponible pour ce choix : choisissez une autre licence.', 'err', 'lic'); }
  if (!r.ok) return say(describe(r), 'err');
  say('Demande enregistrée : identifiant ' + r.data.userPrincipalName + '. Elle attend la validation de la direction.', 'ok');
  $('form').reset(); $('manager').textContent = 'aucun';
  loadLicences();
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
  if (!r.ok) return say(describe(r), 'err');
  say(action === 'valider' ? 'Demande validée, licence attribuée, dossier SharePoint prêt.' : 'Demande refusée, compte supprimé.', 'ok');
  load();
}
load();
`;

export const ACTIVATION_SCRIPT = `
const LABEL = { activer: 'Activer', regenerer: 'Régénérer le TAP' };
function showTap(d, t) {
  const box = $('tap'); box.replaceChildren();
  box.append(
    el('div', { class: 'msg ok' },
      el('p', { text: 'TAP pour ' + d.nom + ' : à remettre en main propre. Il ne sera plus affiché.' }),
      el('div', { class: 'tap', text: t.temporaryAccessPass }),
      el('p', { text: 'Valable ' + t.lifetimeInMinutes + ' minutes' + (t.isUsableOnce ? ', usage unique.' : '.') }),
      el('button', { type: 'button', text: 'Masquer', onclick: () => box.replaceChildren() })));
}
async function load() {
  const body = $('rows'); body.replaceChildren();
  const r = await api('GET', '/api/activations');
  if (!r.ok) return say(describe(r), 'err');
  if (r.data.tronque) say('Liste tronquée : seuls les 100 premiers comptes par statut sont affichés.');
  if (r.data.demandes.length === 0) body.append(el('tr', {}, el('td', { colspan: 6, text: 'Aucun compte à activer.' })));
  for (const d of r.data.demandes) {
    const cell = d.action === 'attendre'
      ? el('td', { text: 'Pas avant la date d\\u2019arrivée' })
      : el('td', {}, el('button', { type: 'button', text: LABEL[d.action], onclick: () => act(d) }));
    body.append(el('tr', {},
      el('td', { text: d.nom }), el('td', { text: d.poste || '' }), el('td', { text: d.service || '' }),
      el('td', { text: d.dateArrivee || '' }), el('td', { text: d.statut }), cell));
  }
}
async function act(d) {
  say(''); $('tap').replaceChildren();
  const regen = d.action === 'regenerer';
  if (regen && !confirm('Régénérer le TAP de ' + d.nom + ' ? Le TAP précédent sera supprimé.')) return;
  const r = await api('POST', '/api/demandes/' + d.id + '/activer', {});
  if (!r.ok) return say(describe(r), 'err');
  say(regen ? 'TAP régénéré.' : 'Compte activé.', 'ok');
  showTap(d, r.data);
  r.data.temporaryAccessPass = '';
  load();
}
load();
`;
