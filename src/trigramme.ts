import { normalizePart } from './upn';

/**
 * Trigramme de l'arrivant (initiales utilisées partout chez Telesio, Salesforce compris) : trois lettres A-Z, posé dans l'attribut
 * natif `onPremisesExtensionAttributes.extensionAttribute1` (inscriptible par Graph pour un compte cloud) et unique dans Entra.
 * Jamais tracé : il désigne une personne.
 */
export const TRIGRAMME_RE = /^[A-Z]{3}$/;

const lettres = (s: string) => normalizePart(s).replace(/[^a-z]/g, '');

/** Initiale du prénom et deux premières lettres du nom, en majuscules sans accents ; null si le nom ou le prénom n'en donne pas assez. */
export function proposerTrigramme(prenom: string, nom: string): string | null {
  const t = `${lettres(prenom).slice(0, 1)}${lettres(nom).slice(0, 2)}`.toUpperCase();
  return TRIGRAMME_RE.test(t) ? t : null;
}

/**
 * Trigramme saisi (rogné, mis en majuscules) ; absent : celui proposé d'après le prénom et le nom (client d'avant le champ).
 * `identite` absente : prénom ou nom déjà refusés, rien n'est proposé ni signalé en plus (leur erreur suffit).
 */
export function lireTrigramme(raw: unknown, identite: { prenom?: string; nom?: string } | undefined): { trigramme?: string; erreur?: string } {
  const erreur = 'trois lettres sans accent requises (A-Z)';
  if (raw === undefined) {
    if (!identite?.prenom || !identite.nom) return {};
    const propose = proposerTrigramme(identite.prenom, identite.nom);
    return propose ? { trigramme: propose } : { erreur };
  }
  const t = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return TRIGRAMME_RE.test(t) ? { trigramme: t } : { erreur };
}

/** extensionAttribute1 lu dans Entra : un trigramme bien formé, sinon null (non renseigné, ou valeur d'un autre usage). */
export const trigrammeLu = (v: unknown): string | null => {
  const t = (v as { extensionAttribute1?: unknown } | null | undefined)?.extensionAttribute1;
  return typeof t === 'string' && TRIGRAMME_RE.test(t) ? t : null;
};
