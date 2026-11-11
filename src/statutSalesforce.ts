import type { ReadyConfig } from './config';
import type { Directory, Provisionnement } from './directory';

/**
 * Statut Salesforce d'une demande (page de détail), d'après les journaux de provisionnement d'Entra : le portail ne parle jamais
 * à Salesforce. `ok` : compte créé ou mis à jour ; `ko` : échec, avec la raison du connecteur ; `en_attente` : pas encore traité,
 * ou sauté (compte Entra désactivé : Salesforce n'est servi qu'après l'activation) ; `hors_perimetre` : pas dans le groupe
 * Salesforce ; `illisible` : lecture Graph en échec. Les journaux arrivent avec quelques minutes de retard.
 */
export type EtatSalesforce = 'ok' | 'ko' | 'en_attente' | 'hors_perimetre' | 'illisible';

export interface StatutSalesforce {
  etat: EtatSalesforce;
  /** Date de la dernière entrée des journaux ; null sans entrée. */
  le: string | null;
  raison: string | null;
  /** Email du responsable envoyé à Salesforce (extensionAttribute2), que le flux Salesforce rattache par Federation ID. */
  emailResponsable: string | null;
}

/** Lecture tolérante aux échecs (`lectureDouce` du détail) : le repli est rendu et l'échec tracé. */
export type Douce = <T>(etape: string, repli: T, fn: () => Promise<T>) => Promise<T>;

/** Une minute : la page de détail est relue souvent, les journaux bougent peu et la requête est lente. */
const TTL_MS = 60_000;
const MAX_ENTREES = 500;
const cache = new Map<string, { expire: number; valeur: Provisionnement | null }>();

/** Vide le cache (tests). */
export const viderCacheSalesforce = () => cache.clear();

async function journal(directory: Directory, id: string, sp: string, now: number): Promise<Provisionnement | null> {
  const lu = cache.get(id);
  if (lu && lu.expire > now) return lu.valeur;
  const valeur = await directory.lireProvisionnement(id, sp);
  if (cache.size >= MAX_ENTREES) cache.clear();
  cache.set(id, { expire: now + TTL_MS, valeur });
  return valeur;
}

/** `undefined` : journal illisible ; `null` : aucune entrée encore. */
export function etatDe(membre: boolean | null, entree: Provisionnement | null | undefined): EtatSalesforce {
  if (membre === false) return 'hors_perimetre';
  if (membre === null || entree === undefined) return 'illisible';
  if (entree === null || entree.statut === 'skipped') return 'en_attente';
  return entree.statut === 'failure' ? 'ko' : 'ok';
}

/** undefined : Salesforce non configuré (groupe ou principal de service absent). Le cache n'est jamais posé sur un échec. */
export async function lireStatutSalesforce(
  doux: Douce,
  deps: { config: ReadyConfig; directory: Directory },
  id: string,
  emailResponsable: string | null,
  now = Date.now(),
): Promise<StatutSalesforce | undefined> {
  const { salesforceGroupId: groupe, salesforceServicePrincipalId: sp } = deps.config;
  if (!groupe || !sp) return undefined;
  const membre = await doux<boolean | null>('detail_groupe_salesforce', null, () => deps.directory.isMemberOfGroup(id, groupe));
  const entree = membre ? await doux<Provisionnement | null | undefined>('detail_salesforce', undefined, () => journal(deps.directory, id, sp, now)) : null;
  const etat = etatDe(membre, entree);
  const montre = etat === 'hors_perimetre' ? null : entree ?? null;
  return { etat, le: montre?.le ?? null, raison: etat === 'ok' ? null : montre?.raison ?? null, emailResponsable };
}
