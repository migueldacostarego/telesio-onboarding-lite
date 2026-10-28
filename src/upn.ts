const LIGATURES: Record<string, string> = {
  œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', đ: 'd', ł: 'l', ð: 'd', þ: 'th',
};

/** Minuscules, sans accents, espaces ni apostrophes ; seuls a-z, 0-9 et - sont conservés. */
export function normalizePart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[œæßøđłðþ]/g, (c) => LIGATURES[c] ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Partie locale de l'UPN : prenom.nom ; la limite Entra est de 64 caractères. */
export const MAX_LOCAL_BASE = 60;

export function upnBase(prenom: string, nom: string): string {
  return `${normalizePart(prenom)}.${normalizePart(nom)}`;
}

/** n = 1 : prenom.nom ; n >= 2 : prenom.nom2, prenom.nom3, … */
export function upnCandidate(base: string, domain: string, n: number): string {
  return `${base}${n > 1 ? n : ''}@${domain}`;
}
