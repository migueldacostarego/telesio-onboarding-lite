import { ApiError } from '@/lib/api';

/** Longueur maximale du motif de refus (limite de l'API). */
export const MOTIF_MAX = 500;

/**
 * Compte tout juste créé : Entra ne l'a pas encore répliqué et `valider` répond 404 avant toute écriture. C'est le seul cas
 * où l'interface rejoue une écriture d'elle-même (sans risque : rien n'a été écrit), 6 fois au plus, environ une minute.
 */
export const REESSAIS_COMPTE_MS = [5_000, 5_000, 10_000, 10_000, 15_000, 15_000] as const;

/** 202 `licence_en_cours` : revalidation automatique après 60 s, 5 fois au plus (5 minutes), puis la main revient à la personne. */
export const REVALIDATION_LICENCE_MS = 60_000;
export const REVALIDATIONS_LICENCE_MAX = 5;

export type ActionNom = 'valider' | 'refuser';

/** Ce que la ligne montre pour une demande dont une action est en cours (jamais le contenu d'une saisie). */
export type EtatLigne =
  | { phase: 'en_cours'; action: ActionNom }
  | { phase: 'compte_en_creation' }
  | { phase: 'licence_en_cours' }
  /** La licence tarde : l'attribution automatique a atteint son plafond de revalidations. La ligne est rendue. */
  | { phase: 'licence_lente' }
  | { phase: 'erreur'; action: ActionNom; error: unknown };

/** Vrai tant que quelque chose tourne pour cette ligne : rien d'autre n'y est cliquable. */
export const verrouille = (etat: EtatLigne | undefined): boolean =>
  etat !== undefined && etat.phase !== 'erreur' && etat.phase !== 'licence_lente';

/** Id d'une demande dans une adresse de l'API (corps de la requête : le motif n'est jamais dans l'URL). */
export const cheminAction = (id: string, action: ActionNom): string => `/api/demandes/${encodeURIComponent(id)}/${action}`;

/** 404 sur `valider` : le compte n'est pas encore là (réplication), ou n'existe plus. */
export const estCompteIntrouvable = (error: unknown): boolean => error instanceof ApiError && error.status === 404;
