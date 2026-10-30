/** Fuseau des dates affichées : l'heure de Paris, quel que soit le fuseau du navigateur (celui du serveur métier est `TZ_METIER`, Europe/Paris par défaut). */
export const FUSEAU = 'Europe/Paris';

const JOUR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: FUSEAU });
const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: FUSEAU });
const JOUR_PARIS = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: FUSEAU });

/** « 30 oct. 2026 à 14:05 » : un instant (date ISO de l'API, en UTC) en heure de Paris. */
export function formatInstant(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Date illisible' : `${JOUR.format(d)} à ${HEURE.format(d)}`;
}

/** AAAA-MM-JJ du jour à Paris : « aujourd'hui » pour l'arrivée (une date sans heure), indépendant du fuseau du navigateur. */
export function jourAParis(maintenant: Date = new Date()): string {
  return JOUR_PARIS.format(maintenant);
}

const MS_PAR_JOUR = 86_400_000;

/** Écart en jours entiers entre deux dates AAAA-MM-JJ (lues en UTC : jamais décalées par un fuseau). Positif : `iso` est dans le futur. */
export function ecartJours(iso: string, reference: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / MS_PAR_JOUR);
}

/** « Aujourd'hui », « Demain », « Dans 5 j », « Hier », « Il y a 3 j » pour une date d'arrivée ; `null` si la date manque. */
export function arriveeRelative(iso: string | null, aujourdhui: string): string | null {
  if (!iso) return null;
  const n = ecartJours(iso, aujourdhui);
  if (Number.isNaN(n)) return null;
  if (n === 0) return 'Aujourd’hui';
  if (n === 1) return 'Demain';
  if (n === -1) return 'Hier';
  return n > 0 ? `Dans ${n} j` : `Il y a ${-n} j`;
}
