import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import type { Audit, AuditEvent } from '../../src/audit';
import { assertReady, loadConfig } from '../../src/config';
import { GraphDirectory } from '../../src/directory';
import { GraphSharePoint } from '../../src/sharepoint';
import { FakeGraph } from './fakeGraph';

export const EXT = 'extension_0123456789abcdef0123456789abcdef_statutOnboarding';
export const NOW = new Date('2026-10-27T10:00:00Z');
export const RH_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
export const DIR_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
export const GROUP_ID = 'cccccccc-0000-4000-8000-000000000003';
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

export const principal = (roles: string[] = [], oid = RH_ID) =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: oid },
        ...roles.map((r) => ({ typ: 'roles', val: r })),
      ],
    }),
  ).toString('base64');

export function setup(env: Record<string, string | undefined> = {}, opts: { trustAuthHeaders?: boolean; withLibrary?: boolean } = {}) {
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
      DIRECTION_TYPE: 'user',
      DIRECTION_OBJECT_ID: DIR_ID,
      SHAREPOINT_SITE_ID: SITE,
      SHAREPOINT_DRIVE_ID: DRIVE,
      LICENSES: LICENSES_JSON,
      ENTRA_LICENSE_EXTENSION: EXT_LIC,
      ...env,
    }),
    trustAuthHeaders: opts.trustAuthHeaders ?? true,
  });
  const app = createApp({
    config,
    directory: new GraphDirectory(graph.asClient()),
    library: opts.withLibrary === false ? undefined : new GraphSharePoint(graph.asClient(), SITE, DRIVE),
    audit,
    now: () => NOW,
    managerRetryDelaysMs: [0, 0],
    licensePollDelaysMs: [0, 0, 0],
    sleep: async () => {},
  });
  return { graph, events, app };
}

export async function listen(app: ReturnType<typeof setup>['app']): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((r) => void server.close(() => r())),
  };
}
