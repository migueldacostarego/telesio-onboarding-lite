/**
 * Pays de l'arrivant : son code ISO est posé dans l'attribut natif `usageLocation` (Entra n'attribue aucune licence sans lui),
 * et son nom dans l'attribut natif `country` (lisible dans le portail). L'application relit le code (`usageLocation`).
 */
export const PAYS = { FR: 'France', MU: 'Maurice' } as const;
export type CodePays = keyof typeof PAYS;
export const CODES_PAYS = Object.keys(PAYS) as CodePays[];
/** Pays posé quand la demande n'en précise pas (client d'avant le champ) : celui de toutes les demandes jusqu'ici. */
export const PAYS_PAR_DEFAUT: CodePays = 'FR';

export const estCodePays = (v: unknown): v is CodePays => typeof v === 'string' && Object.hasOwn(PAYS, v);

/** `usageLocation` lu dans Entra : un code connu, sinon null (non renseigné ou autre pays). */
export const paysLu = (v: unknown): CodePays | null => (estCodePays(v) ? v : null);
