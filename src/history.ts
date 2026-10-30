import { GUID_RE } from './validation';

/** Auteur d'une étape faite par le serveur lui-même (tâche de terminaison) : pas un objectId de personne. */
export const ACTEUR_SYSTEME = 'systeme';

/** Une étape de l'historique : qui (objectId, ou `systeme`) et quand (date ISO UTC). */
export interface Evenement {
  par: string;
  le: string;
  /** Régénérations seulement : nombre de remises depuis l'activation (la dernière est celle de l'événement). */
  nombre?: number;
}

/**
 * Valeur d'une extension d'historique : `<objectId>|<date ISO>` (régénération : `…|<nombre>`). 65 caractères au plus, loin de la
 * limite de 256 d'une extension Entra de type chaîne. Seul un objectId est écrit comme auteur : tout autre acteur (la tâche de
 * terminaison) devient `systeme`. Jamais de nom ni d'adresse.
 */
export function encoderEvenement(acteur: string, quand: Date, nombre?: number): string {
  const par = GUID_RE.test(acteur) ? acteur.toLowerCase() : ACTEUR_SYSTEME;
  return [par, quand.toISOString(), ...(nombre === undefined ? [] : [String(nombre)])].join('|');
}

/** Relit une extension d'historique ; une valeur absente ou illisible n'est pas une erreur (étape faite avant l'historique). */
export function decoderEvenement(brut: unknown): Evenement | null {
  if (typeof brut !== 'string') return null;
  const [par, le, nombre] = brut.split('|');
  if (!par || !le || !Number.isFinite(Date.parse(le))) return null;
  if (par !== ACTEUR_SYSTEME && !GUID_RE.test(par)) return null;
  const n = nombre === undefined ? undefined : Number(nombre);
  return { par: par.toLowerCase(), le, ...(n !== undefined && Number.isInteger(n) && n > 0 ? { nombre: n } : {}) };
}
