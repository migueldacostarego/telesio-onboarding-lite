import type { LicenseOption } from './config';
import { MAX_LOCAL_BASE, normalizePart, upnBase } from './upn';

export interface DemandeInput {
  prenom: string;
  nom: string;
  /** YYYY-MM-DD */
  dateArrivee: string;
  poste: string;
  service: string;
  managerId: string;
  /** skuId (en minuscules) choisi parmi les licences proposées. */
  licence: string;
}

export type Validation =
  | { ok: true; value: DemandeInput }
  | { ok: false; details: Record<string, string> };

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// Limites Entra : givenName/surname/department 64, jobTitle 128.
const LIMITS = { prenom: 64, nom: 64, poste: 128, service: 64 } as const;

function text(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > 0 && s.length <= max && !CONTROL_RE.test(s) ? s : undefined;
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** `today` : AAAA-MM-JJ dans le fuseau métier (voir todayIn). */
export function validateDemande(body: unknown, today: string, licenses: readonly LicenseOption[]): Validation {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const details: Record<string, string> = {};

  const prenom = text(b.prenom, LIMITS.prenom);
  const nom = text(b.nom, LIMITS.nom);
  const poste = text(b.poste, LIMITS.poste);
  const service = text(b.service, LIMITS.service);
  if (!prenom) details.prenom = `requis, ${LIMITS.prenom} caractères max`;
  if (!nom) details.nom = `requis, ${LIMITS.nom} caractères max`;
  if (!poste) details.poste = `requis, ${LIMITS.poste} caractères max`;
  if (!service) details.service = `requis, ${LIMITS.service} caractères max`;

  if (prenom && nom) {
    if (!normalizePart(prenom)) details.prenom = 'doit contenir au moins une lettre latine ou un chiffre';
    if (!normalizePart(nom)) details.nom = 'doit contenir au moins une lettre latine ou un chiffre';
    if (!details.prenom && !details.nom && upnBase(prenom, nom).length > MAX_LOCAL_BASE) {
      details.nom = `prénom et nom trop longs pour former un identifiant (${MAX_LOCAL_BASE} caractères max)`;
    }
  }

  const dateArrivee = typeof b.dateArrivee === 'string' ? b.dateArrivee.trim() : '';
  if (!isRealDate(dateArrivee)) details.dateArrivee = 'date valide au format AAAA-MM-JJ requise';
  else if (dateArrivee < today) details.dateArrivee = 'ne peut pas être dans le passé';

  const managerId = typeof b.managerId === 'string' ? b.managerId.trim() : '';
  if (!GUID_RE.test(managerId)) details.managerId = 'objectId Entra (GUID) requis';

  const choix = typeof b.licence === 'string' ? b.licence.trim().toLowerCase() : '';
  const licence = licenses.find((l) => l.skuId === choix)?.skuId;
  if (!licence) details.licence = 'licence non proposée (choisir dans la liste)';

  if (Object.keys(details).length > 0 || !licence || !prenom || !nom || !poste || !service) {
    return { ok: false, details };
  }
  return { ok: true, value: { prenom, nom, dateArrivee, poste, service, managerId, licence } };
}

export type MotifValidation = { ok: true; motif: string } | { ok: false; details: Record<string, string> };

export function validateMotif(body: unknown): MotifValidation {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const motif = text(b.motif, 500);
  return motif ? { ok: true, motif } : { ok: false, details: { motif: 'requis, 500 caractères max' } };
}
