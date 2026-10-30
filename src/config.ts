import { isValidTimeZone } from './dates';
import { checkFolderPattern, DEFAULT_FOLDER_PATTERN } from './folder';
import { TYPES_CONTRAT, type TypeContrat } from './typeContrat';


export interface Config {
  port: number;
  /** Domaine des UPN générés (ex. contoso.com). Obligatoire au démarrage. */
  upnDomain?: string;
  /** Nom complet de l'attribut d'extension Entra : extension_<appId sans tirets>_statutOnboarding. Obligatoire au démarrage. */
  statusExtension?: string;
  /** Rôle d'application (Easy Auth) qui donne accès aux routes RH. */
  rhRole: string;
  /** Rôle d'application Direction : donne tous les droits de RH (`creer`, `activer`) plus `approuver` (valider ou refuser, y compris ses propres demandes : tracé). */
  directionRole: string;
  /** Fuseau qui définit « aujourd'hui » (jour J, date d'arrivée dans le passé). */
  timeZone: string;
  /** Faire confiance à l'en-tête d'identité Easy Auth (jamais sans Easy Auth, sauf dev local). */
  trustAuthHeaders: boolean;
  /** Dossier SharePoint : site, bibliothèque (drive) et motif de nom ({nom}, {prenom}, {id}). */
  sharePoint: { siteId?: string; driveId?: string; folderPattern: string };
  /** Licences proposées à RH : un SKU et son groupe Entra (licence par groupe). Vide = demandes et validation répondent 503. */
  licenses: LicenseOption[];
  /**
   * Licence de chaque type de contrat (LICENCES_PAR_TYPE) : le skuId, qui figure dans `licenses`. Chaque type est facultatif : un type absent
   * n'a pas de licence prévue (la création répond 409 « aucune licence disponible pour ce type de contrat »). Variable absente : la création
   * de demande répond 503 (ce n'est pas une erreur de démarrage : l'application reste disponible pendant un déploiement en deux temps).
   */
  licenseByType?: Partial<Record<TypeContrat, string>>;
  /** Nom complet de l'attribut d'extension qui porte le skuId choisi : extension_<appId sans tirets>_licenceOnboarding. */
  licenseExtension?: string;
  /** Groupe de sécurité des arrivants : ajouté à la validation, retiré à Terminé. Cible de l'accès conditionnel qui impose Authenticator. Absent : activation fermée (503). */
  arrivantsGroupId?: string;
  /** Extension qui porte la date d'activation : extension_<appId sans tirets>_activationOnboarding. Absente : activation fermée (503). */
  activationExtension?: string;
  /** Extension qui porte l'objectId du créateur de la demande (extension_<appId>_createurOnboarding) : écrite à la création, lue pour tracer l'auto-approbation (demande.auto_approbation). */
  creatorExtension?: string;
  /**
   * Extensions de l'historique (auteur et date de chaque étape, au format `acteur|date ISO`) : validation, première activation,
   * dernière régénération du mot de passe (avec le nombre de régénérations) et passage à Terminé. Toutes ou aucune. Absentes :
   * l'historique n'est pas enregistré (aucune écriture de plus, jamais de 503) et la page de détail le dit.
   */
  history?: HistoryExtensions;
  /** Période de la tâche qui termine les comptes Actif dont l'onboarding est complet (ms). 0 : tâche désactivée. Défaut : 5 minutes. */
  terminaisonIntervalMs: number;
}

export interface HistoryExtensions {
  validation: string;
  activation: string;
  regeneration: string;
  termine: string;
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

/** LICENCES_PAR_TYPE : objet JSON { "Employé": skuId, "Contractor": skuId }, chaque entrée facultative (absente ou null : pas de licence pour ce type), chaque skuId étant l'un de LICENSES. */
function parseLicenseByType(raw: string | undefined, licenses: LicenseOption[]): Partial<Record<TypeContrat, string>> | undefined {
  const v = opt(raw);
  if (v === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    throw new Error(`LICENCES_PAR_TYPE invalide (attendu : objet JSON { ${TYPES_CONTRAT.map((t) => `"${t}": skuId`).join(', ')} })`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`LICENCES_PAR_TYPE invalide (attendu : objet JSON { ${TYPES_CONTRAT.map((t) => `"${t}": skuId`).join(', ')} })`);
  }
  const o = parsed as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !(TYPES_CONTRAT as readonly string[]).includes(k));
  if (extra.length > 0) throw new Error(`LICENCES_PAR_TYPE : type inconnu (${extra.join(', ')}) ; attendus : ${TYPES_CONTRAT.join(', ')}`);
  const out: Partial<Record<TypeContrat, string>> = {};
  for (const type of TYPES_CONTRAT) {
    if (o[type] === undefined || o[type] === null) continue;
    const sku = typeof o[type] === 'string' ? (o[type] as string).trim().toLowerCase() : '';
    if (!GUID_RE.test(sku)) throw new Error(`LICENCES_PAR_TYPE.${type} invalide (attendu : le skuId d'une licence de LICENSES)`);
    if (!licenses.some((l) => l.skuId === sku)) throw new Error(`LICENCES_PAR_TYPE.${type} : ce SKU ne figure pas dans LICENSES`);
    out[type] = sku;
  }
  return out;
}

const HISTORY_ENV = {
  validation: 'ENTRA_HISTORY_VALIDATION_EXTENSION',
  activation: 'ENTRA_HISTORY_ACTIVATION_EXTENSION',
  regeneration: 'ENTRA_HISTORY_REGENERATION_EXTENSION',
  termine: 'ENTRA_HISTORY_TERMINE_EXTENSION',
} as const;

/** Les quatre extensions de l'historique, toutes ou aucune (un historique à moitié enregistré serait trompeur). */
function parseHistory(env: NodeJS.ProcessEnv): HistoryExtensions | undefined {
  const entries = Object.entries(HISTORY_ENV).map(([key, name]) => [key, name, opt(env[name])] as const);
  if (entries.every(([, , v]) => v === undefined)) return undefined;
  const missing = entries.filter(([, , v]) => v === undefined).map(([, name]) => name);
  if (missing.length > 0) throw new Error(`Historique : variables manquantes (${missing.join(', ')}) ; les quatre ou aucune`);
  for (const [, name, v] of entries) {
    if (!EXTENSION_RE.test(v as string)) throw new Error(`${name} invalide (attendu : extension_<appId sans tirets>_<nom>)`);
  }
  return Object.fromEntries(entries.map(([key, , v]) => [key, v])) as unknown as HistoryExtensions;
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
  const licenseByType = parseLicenseByType(env.LICENCES_PAR_TYPE, licenses);
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
  const history = parseHistory(env);
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
    licenseByType,
    licenseExtension,
    arrivantsGroupId: arrivantsGroupRaw?.toLowerCase(),
    activationExtension,
    creatorExtension,
    history,
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
