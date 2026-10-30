import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import type { Audit, AuditEvent } from '../../src/audit';
import { assertReady, loadConfig } from '../../src/config';
import { GraphDirectory } from '../../src/directory';
import type { KeyedLock } from '../../src/lock';
import { GraphSharePoint } from '../../src/sharepoint';
import { FakeGraph } from './fakeGraph';

export const EXT = 'extension_0123456789abcdef0123456789abcdef_statutOnboarding';
export const NOW = new Date('2026-10-27T10:00:00Z');
export const RH_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
export const DIR_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
export const EXT_ACT = 'extension_0123456789abcdef0123456789abcdef_activationOnboarding';
/** Groupe des arrivants : ajouté à la validation (rejoué à l'activation), retiré à Terminé. */
export const ARRIVANTS_GROUP = 'ffffffff-0000-4000-8000-0000000000a1';
/** Extension qui porte l'objectId du créateur de la demande (trace de l'auto-approbation). */
export const EXT_CREATOR = 'extension_0123456789abcdef0123456789abcdef_createurOnboarding';
export const EXT_LIC = 'extension_0123456789abcdef0123456789abcdef_licenceOnboarding';
/** Trois licences proposées : A (5 unités, 1 consommée), B (3 unités libres), ZERO (2 unités, 2 consommées). */
export const LICENSE_GROUP = 'dddddddd-0000-4000-8000-000000000004';
export const LICENSE_SKU = 'eeeeeeee-0000-4000-8000-000000000005';
export const LICENSE_GROUP_B = 'dddddddd-0000-4000-8000-0000000000b4';
export const LICENSE_SKU_B = 'eeeeeeee-0000-4000-8000-0000000000b5';
export const LICENSE_GROUP_ZERO = 'dddddddd-0000-4000-8000-0000000000a4';
export const LICENSE_SKU_ZERO = 'eeeeeeee-0000-4000-8000-0000000000a5';
export const LICENSES_JSON = JSON.stringify([
  { skuId: LICENSE_SKU, libelle: 'Business Premium', groupId: LICENSE_GROUP },
  { skuId: LICENSE_SKU_B, libelle: 'Business Standard', groupId: LICENSE_GROUP_B },
  { skuId: LICENSE_SKU_ZERO, libelle: 'Business Basic', groupId: LICENSE_GROUP_ZERO },
]);
export const SITE = 'exemple.sharepoint.test,11111111-2222-4333-8444-555555555555,66666666-7777-4888-8999-000000000000';
export const DRIVE = 'b!abc_DEF-123';

export const principal = (roles: string[] = [], oid = RH_ID, extra: { typ: string; val: string }[] = []) =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: oid },
        ...roles.map((r) => ({ typ: 'roles', val: r })),
        ...extra,
      ],
    }),
  ).toString('base64');

export function setup(env: Record<string, string | undefined> = {}, opts: { trustAuthHeaders?: boolean; withLibrary?: boolean; now?: () => Date; webDir?: string; lock?: KeyedLock } = {}) {
  const graph = new FakeGraph();
  graph.skus.set(LICENSE_SKU, { enabled: 5, consumed: 1 });
  graph.skus.set(LICENSE_SKU_B, { enabled: 3, consumed: 0 });
  graph.skus.set(LICENSE_SKU_ZERO, { enabled: 2, consumed: 2 });
  graph.licenseGroups.set(LICENSE_GROUP, LICENSE_SKU);
  graph.licenseGroups.set(LICENSE_GROUP_B, LICENSE_SKU_B);
  graph.licenseGroups.set(LICENSE_GROUP_ZERO, LICENSE_SKU_ZERO);
  const events: AuditEvent[] = [];
  const audit: Audit = { track: (e) => void events.push(e), flush: async () => {} };
  const config = assertReady({
    ...loadConfig({
      UPN_DOMAIN: 'exemple.test',
      ENTRA_STATUS_EXTENSION: EXT,
      SHAREPOINT_SITE_ID: SITE,
      SHAREPOINT_DRIVE_ID: DRIVE,
      LICENSES: LICENSES_JSON,
      ENTRA_LICENSE_EXTENSION: EXT_LIC,
      ARRIVANTS_GROUP_ID: ARRIVANTS_GROUP,
      ENTRA_ACTIVATION_EXTENSION: EXT_ACT,
      ENTRA_CREATOR_EXTENSION: EXT_CREATOR,
      ...env,
    }),
    trustAuthHeaders: opts.trustAuthHeaders ?? true,
  });
  const directory = new GraphDirectory(graph.asClient());
  const app = createApp({
    config,
    directory,
    library: opts.withLibrary === false ? undefined : new GraphSharePoint(graph.asClient(), SITE, DRIVE),
    audit,
    lock: opts.lock,
    now: opts.now ?? (() => NOW),
    managerRetryDelaysMs: [0, 0],
    licensePollDelaysMs: [0, 0, 0],
    sleep: async () => {},
  }, { webDir: opts.webDir });
  return { graph, events, app, config, directory, audit };
}

export async function listen(app: ReturnType<typeof setup>['app']): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((r) => void server.close(() => r())),
  };
}
