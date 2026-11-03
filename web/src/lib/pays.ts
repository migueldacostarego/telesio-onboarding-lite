/** Pays de l'arrivant : le serveur pose le code dans `usageLocation` (licences) et le nom dans `country` (attributs natifs d'Entra). */
export const PAYS = { FR: 'France', MU: 'Maurice' } as const;
export type CodePays = keyof typeof PAYS;
export const CODES_PAYS = Object.keys(PAYS) as [CodePays, ...CodePays[]];
export const PAYS_PAR_DEFAUT: CodePays = 'FR';
