import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';

/** Mot de passe initial de la création du compte : 32 caractères aléatoires, jamais communiqué, jamais stocké. */
export function randomPassword(length = 32): string {
  const sets = [UPPER, LOWER, DIGITS, '!#$%&*+-=?@_'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)] as string);
  while (chars.length < length) chars.push(all[randomInt(all.length)] as string);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}

/**
 * Mot de passe temporaire remis en main propre le jour J : facile à recopier (sans 0/O, 1/l/I), quatre groupes de
 * quatre séparés par des tirets, ex. « Kp7m-Xq4r-Tz9w-Hb3n » (environ 66 bits). Majuscule, minuscule, chiffre et
 * symbole (tiret) : conforme à la politique de complexité d'Entra. Changement imposé à la première connexion.
 */
export function temporaryPassword(): string {
  const pick = (s: string) => s[randomInt(s.length)] as string;
  return Array.from({ length: 4 }, () => pick(UPPER) + pick(LOWER) + pick(DIGITS) + pick(LOWER)).join('-');
}
