import type { LicenseOption } from './config';
import { ServiceError } from './demandes';
import type { LicenseRead, SkuAvailability } from './directory';
import { step, type DirectionDeps } from './direction';

/** Attentes entre deux lectures de l'état de licence : le traitement par groupe est asynchrone (quelques secondes à une minute). */
const DEFAULT_POLL_DELAYS_MS = [2000, 3000, 5000, 5000, 5000, 5000, 5000];

export interface LicenseDeps extends DirectionDeps {
  licensePollDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

export const PENDING_MESSAGE = 'Licence en cours d’attribution, revalidez dans une minute';

const NO_LICENSE = { error: 'Aucune licence disponible', code: 'licence_indisponible' } as const;

export interface LicenceDisponible {
  skuId: string;
  libelle: string;
  disponibles: number;
}

export const SKU_CACHE_TTL_MS = 60_000;

/**
 * Cache mémoire de GET /subscribedSkus, réservé à l'affichage du formulaire RH (listLicences).
 * La création de demande et la validation direction relisent toujours en direct : ne jamais les brancher ici.
 * Une lecture en échec n'est pas conservée (la suivante réessaie).
 */
export class SkuAvailabilityCache {
  private entry?: { at: number; value: Promise<Map<string, SkuAvailability>> };

  constructor(
    private readonly now: () => number,
    private readonly ttlMs = SKU_CACHE_TTL_MS,
  ) {}

  get(load: () => Promise<Map<string, SkuAvailability>>): Promise<Map<string, SkuAvailability>> {
    if (this.entry && this.now() - this.entry.at < this.ttlMs) return this.entry.value;
    const value = load();
    const entry = { at: this.now(), value };
    this.entry = entry;
    value.catch(() => {
      if (this.entry === entry) this.entry = undefined;
    });
    return value;
  }

  /** Après une écriture qui change les unités libres (validation) ou un refus pour manque de licence. */
  invalidate(): void {
    this.entry = undefined;
  }
}

/** Licences proposées à RH avec le nombre d'unités libres (enabled - consumedUnits, jamais négatif). */
export async function listLicences(
  deps: DirectionDeps,
  actor: string,
  cache?: SkuAvailabilityCache,
): Promise<{ licences: LicenceDisponible[] }> {
  const load = () => deps.directory.listSkuAvailability();
  const units = await step(deps, actor, 'licence_disponibilite', undefined, {}, () => (cache ? cache.get(load) : load()));
  const licences = deps.config.licenses.map((l) => {
    const u = units.get(l.skuId);
    return { skuId: l.skuId, libelle: l.libelle, disponibles: u ? Math.max(0, u.enabled - u.consumed) : 0 };
  });
  deps.audit.track({ action: 'licence.liste', actor, outcome: 'ok', resultats: licences.length });
  return { licences };
}

/**
 * Garantit que le compte porte la licence du SKU choisi (option : SKU et groupe de licence), AVANT toute écriture de statut.
 *
 * 1. Le compte porte déjà la licence sans erreur (reprise, ou tentative précédente) : rien à faire. Sans ce
 *    contrôle, le compte compterait dans consumedUnits et la reprise serait refusée à tort.
 * 2. Sinon : enabled - consumedUnits ; 0 ou moins : 409, aucune écriture.
 * 3. Ajout au groupe de licence, puis lecture de l'état jusqu'à une entrée Active ou en erreur.
 *    Erreur (dont CountViolation) : retrait du groupe ; CountViolation donne 409, le reste 502.
 *    Pas d'entrée Active à l'issue des lectures : 202 `licence_en_cours`, le compte reste dans le groupe (la reprise le retrouve licencié).
 * Les identifiants tracés sont des objectIds et les GUID du groupe et du SKU.
 */
export async function ensureLicense(
  deps: LicenseDeps,
  actor: string,
  id: string,
  option: LicenseOption,
): Promise<{ deja: boolean }> {
  const { directory, audit } = deps;
  const { groupId, skuId } = option;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = deps.licensePollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
  const ctx = { cible: id, groupe: groupId, sku: skuId };

  // Dernière lecture, pour diagnostiquer une vérification expirée (états et compteurs seulement, aucun nom).
  let last: LicenseRead = { entry: null, total: 0 };
  let lectures = 0;
  const read = async () => {
    last = await step(deps, actor, 'licence_etat', id, {}, () => directory.readLicenseStates(id, skuId));
    lectures++;
    return last.entry;
  };

  /** Une erreur d'attribution : on sort le compte du groupe, puis 409 (CountViolation) ou 502. */
  const reject = async (code: string): Promise<never> => {
    audit.track({ action: 'licence.refusee', actor, outcome: 'erreur', ...ctx, code });
    await step(deps, actor, 'licence_retrait_groupe', id, {}, () => directory.removeGroupMember(groupId, id));
    audit.track({ action: 'licence.groupe_retrait', actor, outcome: 'ok', ...ctx });
    if (code === 'CountViolation') throw new ServiceError(409, { ...NO_LICENSE });
    throw new ServiceError(502, {
      error: 'Entra a refusé l’attribution de la licence ; l’action n’a pas abouti',
      etape: 'licence_attribution',
      raison: code,
    });
  };

  let state = await read();
  if (state?.error) return reject(state.error);
  if (state?.state === 'Active') {
    audit.track({ action: 'licence.deja_attribuee', actor, outcome: 'ok', ...ctx });
    return { deja: true };
  }

  if (!state) {
    const sku = (await step(deps, actor, 'licence_disponibilite', id, {}, () => directory.listSkuAvailability())).get(skuId);
    if (!sku) {
      audit.track({ action: 'licence.sku_introuvable', actor, outcome: 'erreur', ...ctx });
      throw new ServiceError(503, { error: 'Licence introuvable dans le tenant (LICENSES)' });
    }
    if (sku.enabled - sku.consumed <= 0) {
      audit.track({ action: 'licence.indisponible', actor, outcome: 'refuse', ...ctx, enabled: sku.enabled, consumed: sku.consumed });
      throw new ServiceError(409, { ...NO_LICENSE });
    }
  }

  await step(deps, actor, 'licence_ajout_groupe', id, {}, () => directory.addGroupMember(groupId, id));
  audit.track({ action: 'licence.groupe_ajout', actor, outcome: 'ok', ...ctx });

  for (let i = 0; ; i++) {
    state = await read();
    if (state?.error) return reject(state.error);
    if (state?.state === 'Active') {
      audit.track({ action: 'licence.attribuee', actor, outcome: 'ok', ...ctx, lectures: i + 1 });
      return { deja: false };
    }
    if (i >= delays.length) break;
    await sleep(delays[i] as number);
  }
  audit.track({
    action: 'licence.verification_expiree',
    actor,
    outcome: 'erreur',
    ...ctx,
    lectures,
    entree: last.entry !== null,
    entrees: last.total,
    etat: last.entry?.state,
    erreur: last.entry?.error ?? undefined,
    // false : attribution directe (assignedByGroup null) ou par un autre groupe.
    parGroupe: last.entry ? last.entry.assignedByGroup?.toLowerCase() === groupId.toLowerCase() : undefined,
  });
  // Pas une erreur : Entra traite encore l'attribution. Le compte reste dans le groupe, la reprise le retrouve licencié.
  throw new ServiceError(202, {
    message: PENDING_MESSAGE,
    code: 'licence_en_cours',
    etape: 'licence_verification',
  });
}
