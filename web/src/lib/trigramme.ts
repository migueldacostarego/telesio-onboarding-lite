import { normaliserPartie } from '@/lib/email';

/**
 * Trigramme proposé : initiale du prénom et deux premières lettres du nom, en majuscules sans accents, d'après la règle du serveur
 * (src/trigramme.ts, `proposerTrigramme`). Le serveur reste l'autorité (format, trigramme déjà porté par un compte : 409).
 */
export const TRIGRAMME = /^[A-Z]{3}$/;

const lettres = (s: string) => normaliserPartie(s).replace(/[^a-z]/g, '');

/** Vide tant que le prénom ou le nom ne donne pas assez de lettres. */
export function proposerTrigramme(prenom: string, nom: string): string {
  const t = `${lettres(prenom).slice(0, 1)}${lettres(nom).slice(0, 2)}`.toUpperCase();
  return TRIGRAMME.test(t) ? t : '';
}
