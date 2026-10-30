import { estTypeContrat, TYPES_CONTRAT, type TypeContrat } from './typeContrat';
import { MAX_LOCAL_BASE, normalizePart, upnBase } from './upn';

/** Motifs de régénération du mot de passe temporaire : codes fixes, tracés tels quels (un texte libre pourrait contenir un nom). */
export const MOTIFS_REGENERATION = ['code_perdu', 'code_refuse', 'autre'] as const;
export type MotifRegeneration = (typeof MOTIFS_REGENERATION)[number];

export interface DemandeInput {
  prenom: string;
  nom: string;
  /** YYYY-MM-DD */
  dateArrivee: string;
  poste: string;
  service: string;
  managerId: string;
  /** Type de contrat (`employeeType`) : il détermine la licence (LICENCES_PAR_TYPE), qui ne se choisit plus. */
  typeContrat: TypeContrat;
  /** Adresse professionnelle voulue (UPN), en minuscules, sur le domaine de l'application. Absente : l'identifiant prenom.nom est attribué, avec un suffixe en cas d'homonyme. */
  email?: string;
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

/** Partie locale d'une adresse : lettres minuscules, chiffres, `.` et `-` entre deux caractères alphanumériques ; 64 au plus (limite de mailNickname). */
const LOCAL_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MAX_LOCAL = 64;

/** Adresse sur le domaine `domain` : renvoie l'adresse en minuscules, ou le message d'erreur. Sert à la création et à la vérification de disponibilité. */
export function validerEmail(raw: unknown, domain: string): { ok: true; email: string } | { ok: false; message: string } {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const at = s.indexOf('@');
  if (at < 1 || at !== s.lastIndexOf('@')) return { ok: false, message: `adresse en @${domain} requise` };
  const local = s.slice(0, at);
  if (s.slice(at + 1) !== domain) return { ok: false, message: `le domaine doit être ${domain}` };
  if (local.length > MAX_LOCAL || !LOCAL_RE.test(local)) {
    return { ok: false, message: `avant @ : lettres sans accent, chiffres, points et tirets (${MAX_LOCAL} caractères max)` };
  }
  return { ok: true, email: s };
}

/** `today` : AAAA-MM-JJ dans le fuseau métier (voir todayIn) ; `domain` : domaine des adresses (UPN_DOMAIN). */
export function validateDemande(body: unknown, today: string, domain: string): Validation {
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

  const typeContrat = estTypeContrat(b.typeContrat) ? b.typeContrat : undefined;
  if (!typeContrat) details.typeContrat = `requis, parmi : ${TYPES_CONTRAT.join(', ')}`;
  // La licence découle du type : un client qui l'envoie encore (formulaire d'avant) est refusé plutôt qu'ignoré en silence.
  if (b.licence !== undefined) details.licence = 'ne se choisit plus : elle dépend du type de contrat (typeContrat)';

  let email: string | undefined;
  if (b.email !== undefined) {
    const e = validerEmail(b.email, domain);
    if (e.ok) email = e.email;
    else details.email = e.message;
  }

  if (Object.keys(details).length > 0 || !typeContrat || !prenom || !nom || !poste || !service) {
    return { ok: false, details };
  }
  return { ok: true, value: { prenom, nom, dateArrivee, poste, service, managerId, typeContrat, ...(email ? { email } : {}) } };
}

export type MotifValidation = { ok: true; motif: string } | { ok: false; details: Record<string, string> };

export type RegenerationValidation = { ok: true; motif: MotifRegeneration } | { ok: false; details: Record<string, string> };

/** Motif de régénération du mot de passe temporaire : l'un des codes fixes (tracé tel quel, jamais de texte libre). */
export function validateRegeneration(body: unknown): RegenerationValidation {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const motif = (MOTIFS_REGENERATION as readonly unknown[]).includes(b.motif) ? (b.motif as MotifRegeneration) : undefined;
  return motif ? { ok: true, motif } : { ok: false, details: { motif: `requis, parmi : ${MOTIFS_REGENERATION.join(', ')}` } };
}

export function validateMotif(body: unknown): MotifValidation {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const motif = text(b.motif, 500);
  return motif ? { ok: true, motif } : { ok: false, details: { motif: 'requis, 500 caractères max' } };
}
