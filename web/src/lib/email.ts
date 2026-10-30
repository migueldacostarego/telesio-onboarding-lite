/**
 * Adresse professionnelle proposée : prenom.nom@domaine, d'après la règle du serveur (src/upn.ts, `normalizePart` et `upnBase`) :
 * minuscules, accents retirés, espaces et apostrophes supprimés, seuls a-z, 0-9 et - conservés. Le serveur reste l'autorité (domaine,
 * disponibilité) ; les mêmes cas sont vérifiés des deux côtés (test/app.test.ts et lib/email.test.ts).
 */
const LIGATURES: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', đ: 'd', ł: 'l', ð: 'd', þ: 'th' };

export function normaliserPartie(s: string): string {
  return s
    .toLowerCase()
    .replace(/[œæßøđłðþ]/g, (c) => LIGATURES[c] ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Partie locale d'une adresse : 64 caractères au plus (limite de mailNickname). */
export const MAX_LOCAL = 64;
const LOCAL = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Vide tant que le prénom ou le nom ne donne aucune lettre ou chiffre, ou que le domaine est inconnu. */
export function proposerEmail(prenom: string, nom: string, domaine: string): string {
  const p = normaliserPartie(prenom);
  const n = normaliserPartie(nom);
  return p && n && domaine ? `${p}.${n}@${domaine}` : '';
}

/** Message d'erreur d'une adresse (mêmes règles que `validerEmail` du serveur), ou null si elle est bien formée. L'adresse est déjà en minuscules et sans espaces autour. */
export function erreurEmail(email: string, domaine: string): string | null {
  const at = email.indexOf('@');
  if (email === '') return 'Adresse e-mail requise';
  if (at < 1 || at !== email.lastIndexOf('@')) return `Adresse en @${domaine} requise`;
  if (email.slice(at + 1) !== domaine) return `Le domaine doit être ${domaine}`;
  const local = email.slice(0, at);
  if (local.length > MAX_LOCAL || !LOCAL.test(local)) return `Avant @ : lettres sans accent, chiffres, points et tirets (${MAX_LOCAL} caractères au plus)`;
  return null;
}
