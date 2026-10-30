/** Type de contrat : attribut natif `employeeType` du compte. Le serveur en déduit la licence (LICENCES_PAR_TYPE) : elle ne se choisit plus. */
export const TYPES_CONTRAT = ['Employé', 'Contractor'] as const;
export type TypeContrat = (typeof TYPES_CONTRAT)[number];
export const TYPE_PAR_DEFAUT: TypeContrat = 'Employé';
