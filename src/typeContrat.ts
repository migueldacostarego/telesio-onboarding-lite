/**
 * Type de contrat de l'arrivant : stocké tel quel dans l'attribut natif `employeeType` du compte, et c'est lui qui détermine la licence
 * (voir `LICENCES_PAR_TYPE` dans config.ts). Une valeur d'`employeeType` hors de cette liste (compte créé ailleurs) n'est pas un type connu.
 */
export const TYPES_CONTRAT = ['Employé', 'Contractor'] as const;
export type TypeContrat = (typeof TYPES_CONTRAT)[number];

export const estTypeContrat = (v: unknown): v is TypeContrat => (TYPES_CONTRAT as readonly unknown[]).includes(v);

/** Valeur lue dans Entra : un type connu, sinon null (non renseigné ou autre valeur). */
export const typeLu = (v: unknown): TypeContrat | null => (estTypeContrat(v) ? v : null);
