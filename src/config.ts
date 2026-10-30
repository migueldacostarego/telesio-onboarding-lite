import { isValidTimeZone } from './dates';
import { checkFolderPattern, DEFAULT_FOLDER_PATTERN } from './folder';


export interface Config {
  port: number;
  /** Domaine des UPN générés (ex. contoso.com). Obligatoire au démarrage. */
  upnDomain?: string;
  /** Nom complet de l'attribut d'extension Entra : extension_<appId sans tirets>_statutOnboarding. Obligatoire au démarrage. */
  statusExtension?: string;
  /** Rôle d'application (Easy Auth) qui donne accès aux routes RH. */
  rhRole: string;
  /** Rôle d'application Direction : donne les droits `creer` et `approuver` (valider ou refuser, hors ses propres demandes). */
  directionRole: string;
  /** Fuseau qui définit « aujourd'hui » (jour J, date d'arrivée dans le passé). */
  timeZone: string;
  /** Faire confiance à l'en-tête d'identité Easy Auth (jamais sans Easy Auth, sauf dev local). */
  trustAuthHeaders: boolean;
  /** Dossier SharePoint : site, bibliothèque (drive) et motif de nom ({nom}, {prenom}, {id}). */
  sharePoint: { siteId?: string; driveId?: string; folderPattern: string };
  /** Licences proposées à RH : un SKU et son groupe Entra (licence par groupe). Vide = demandes et validation répondent 503. */
  licenses: LicenseOption[];
  /** Nom complet de l'attribut d'extension qui porte le skuId choisi : extension_<appId sans tirets>_licenceOnboarding. */
  licenseExtension?: string;
  /** Groupe de sécurité des arrivants : ajouté à la validation, retiré à Terminé. Cible de l'accès conditionnel qui impose Authenticator. Absent : activation fermée (503). */
  arrivantsGroupId?: string;
  /** Extension qui porte la date d'activation : extension_<appId sans tirets>_activationOnboarding. Absente : activation fermée (503). */
  activationExtension?: string;
  /** Extension qui porte l'objectId du créateur de la demande (extension_<appId>_createurOnboarding) : refus d'auto-approbation. */
  creatorExtension?: string;
  /** Période de la tâche qui termine les comptes Actif dont l'onboarding est complet (ms). 0 : tâche désactivée. Défaut : 5 minutes. */
  terminaisonIntervalMs: number;
}

export interface LicenseOption {
  skuId: string;
  libelle: string;
  /** Groupe de sécurité porteur de la licence de ce SKU. */
  groupId: string;
}

export type ReadyConfig = Config & { upnDomain: string; statusExtension: string };

export const STATUTS = ['EnAttente', 'Validé', 'Refusé', 'Actif', 'Terminé'] as const;
export type StatutOnboarding = (typeof STATUTS)[number];

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ids Graph de site (host,guid,guid) et de drive (b!…) : insérés tels quels dans un chemin d'API.
const GRAPH_ID_RE = /^[A-Za-z0-9!._,-]+$/;
const EXTENSION_RE = /^extension_[0-9a-f]{32}_[A-Za-z0-9_]+$/i;

const opt = (v: string | undefined): string | undefined => (v?.trim() ? v.trim() : undefined);

/** LICENSES : tableau JSON [{ skuId, libelle, groupId }] ; GUID valides et uniques, libellé de 1 à 64 caractères. */
function parseLicenses(raw: string | undefined): LicenseOption[] {
  const v = opt(raw);
  if (v === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw new Error('LICENSES invalide (attendu : tableau JSON [{ "skuId", "libelle", "groupId" }])');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('LICENSES invalide (tableau non vide attendu)');
  const seenSku = new Set<string>();
  const seenGroup = new Set<string>();
  return parsed.map((item: unknown, i: number) => {
    const o = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const skuId = typeof o.skuId === 'string' ? o.skuId.trim().toLowerCase() : '';
    const groupId = typeof o.groupId === 'string' ? o.groupId.trim().toLowerCase() : '';
    const libelle = typeof o.libelle === 'string' ? o.libelle.trim() : '';
    if (!GUID_RE.test(skuId)) throw new Error(`LICENSES[${i}].skuId invalide (attendu : GUID)`);
    if (!GUID_RE.test(groupId)) throw new Error(`LICENSES[${i}].groupId invalide (attendu : GUID)`);
    if (libelle.length < 1 || libelle.length > 64) throw new Error(`LICENSES[${i}].libelle invalide (1 à 64 caractères)`);
    if (seenSku.has(skuId)) throw new Error(`LICENSES[${i}].skuId en double`);
    if (seenGroup.has(groupId)) throw new Error(`LICENSES[${i}].groupId en double (un groupe par SKU)`);
    seenSku.add(skuId);
    seenGroup.add(groupId);
    return { skuId, libelle, groupId };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const upnDomain = opt(env.UPN_DOMAIN)?.toLowerCase();
  if (upnDomain !== undefined && !DOMAIN_RE.test(upnDomain)) {
    throw new Error('UPN_DOMAIN invalide (attendu : un nom de domaine, ex. contoso.com)');
  }
  const statusExtension = opt(env.ENTRA_STATUS_EXTENSION);
  if (statusExtension !== undefined && !EXTENSION_RE.test(statusExtension)) {
    throw new Error('ENTRA_STATUS_EXTENSION invalide (attendu : extension_<appId sans tirets>_<nom>)');
  }
  const siteId = opt(env.SHAREPOINT_SITE_ID);
  const driveId = opt(env.SHAREPOINT_DRIVE_ID);
  if (siteId !== undefined && !GRAPH_ID_RE.test(siteId)) throw new Error('SHAREPOINT_SITE_ID invalide');
  if (driveId !== undefined && !GRAPH_ID_RE.test(driveId)) throw new Error('SHAREPOINT_DRIVE_ID invalide');
  const licenses = parseLicenses(env.LICENSES);
  const licenseExtension = opt(env.ENTRA_LICENSE_EXTENSION);
  if (licenseExtension !== undefined && !EXTENSION_RE.test(licenseExtension)) {
    throw new Error('ENTRA_LICENSE_EXTENSION invalide (attendu : extension_<appId sans tirets>_<nom>)');
  }
  if (licenses.length > 0 && licenseExtension === undefined) {
    throw new Error('ENTRA_LICENSE_EXTENSION requis quand LICENSES est défini');
  }
  const folderPattern = opt(env.SHAREPOINT_FOLDER_PATTERN) ?? DEFAULT_FOLDER_PATTERN;
  const patternError = checkFolderPattern(folderPattern);
  if (patternError) throw new Error(`SHAREPOINT_FOLDER_PATTERN invalide : ${patternError}`);
  const arrivantsGroupRaw = opt(env.ARRIVANTS_GROUP_ID);
  if (arrivantsGroupRaw !== undefined && !GUID_RE.test(arrivantsGroupRaw)) throw new Error('ARRIVANTS_GROUP_ID invalide (attendu : GUID)');
  const activationExtension = opt(env.ENTRA_ACTIVATION_EXTENSION);
  if (activationExtension !== undefined && !EXTENSION_RE.test(activationExtension)) {
    throw new Error('ENTRA_ACTIVATION_EXTENSION invalide (attendu : extension_<appId sans tirets>_<nom>)');
  }
  const creatorExtension = opt(env.ENTRA_CREATOR_EXTENSION);
  if (creatorExtension !== undefined && !EXTENSION_RE.test(creatorExtension)) {
    throw new Error('ENTRA_CREATOR_EXTENSION invalide (attendu : extension_<appId sans tirets>_<nom>)');
  }
  const timeZone = opt(env.TZ_METIER) ?? 'Europe/Paris';
  if (!isValidTimeZone(timeZone)) throw new Error(`TZ_METIER invalide : "${timeZone}"`);
  const terminaisonRaw = opt(env.TERMINAISON_INTERVAL_MS);
  const terminaisonIntervalMs = terminaisonRaw === undefined ? 300_000 : Number(terminaisonRaw);
  if (!Number.isInteger(terminaisonIntervalMs) || terminaisonIntervalMs < 0 || (terminaisonIntervalMs > 0 && terminaisonIntervalMs < 60_000)) {
    throw new Error('TERMINAISON_INTERVAL_MS invalide (0 pour désactiver, sinon 60000 ms au moins)');
  }
  // Easy Auth pose WEBSITE_AUTH_ENABLED=True. Le contournement de dev est ignoré en production.
  const easyAuth = env.WEBSITE_AUTH_ENABLED?.toLowerCase() === 'true';
  const devBypass = env.ALLOW_INSECURE_DEV_AUTH === 'true' && env.NODE_ENV !== 'production';
  return {
    port: Number(env.PORT ?? 3000),
    upnDomain,
    statusExtension,
    rhRole: opt(env.RH_ROLE) ?? 'RH',
    directionRole: opt(env.DIRECTION_ROLE) ?? 'Direction',
    timeZone,
    trustAuthHeaders: easyAuth || devBypass,
    sharePoint: { siteId, driveId, folderPattern },
    licenses,
    licenseExtension,
    arrivantsGroupId: arrivantsGroupRaw?.toLowerCase(),
    activationExtension,
    creatorExtension,
    terminaisonIntervalMs,
  };
}

/** Échoue au démarrage si la config nécessaire aux routes RH est absente. */
export function assertReady(config: Config): ReadyConfig {
  const missing = [
    config.upnDomain ? '' : 'UPN_DOMAIN',
    config.statusExtension ? '' : 'ENTRA_STATUS_EXTENSION',
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Configuration manquante : ${missing.join(', ')}`);
  return config as ReadyConfig;
}
