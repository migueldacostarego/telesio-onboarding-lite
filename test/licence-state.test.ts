import type { Client } from '@microsoft/microsoft-graph-client';
import { describe, expect, it } from 'vitest';
import { GraphDirectory } from '../src/directory';

const SKU = 'cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46';
const OTHER_SKU = '11111111-2222-4333-8444-555555555555';
const GROUP = '88216ce3-855a-4efd-bc80-46c985242a89';

/** Client Graph réduit à GET /users/{id} : renvoie `states` et enregistre le $select demandé. */
function directoryWith(states: unknown[] | undefined) {
  const seen: { path?: string; select?: string } = {};
  const client = {
    api: (path: string) => {
      seen.path = path;
      const req = { select: (s: string) => ((seen.select = s), req), get: async () => ({ id: 'u', licenseAssignmentStates: states }) };
      return req;
    },
  } as unknown as Pick<Client, 'api'>;
  return { dir: new GraphDirectory(client), seen };
}

describe('readLicenseStates : retrouver l’entrée du SKU', () => {
  it('lit /users/{id} avec $select=id,licenseAssignmentStates', async () => {
    const { dir, seen } = directoryWith([]);
    await dir.readLicenseStates('u1', SKU);
    expect(seen).toEqual({ path: '/users/u1', select: 'id,licenseAssignmentStates' });
  });

  it('compare le skuId sans tenir compte de la casse, des deux côtés', async () => {
    const { dir } = directoryWith([{ skuId: SKU.toUpperCase(), state: 'Active', error: 'None', assignedByGroup: GROUP }]);
    expect((await dir.readLicenseStates('u', SKU)).entry).toMatchObject({ state: 'Active', error: null });
    expect((await dir.readLicenseStates('u', SKU.toUpperCase())).entry).toMatchObject({ state: 'Active' });
  });

  it('error « None » (réponse réelle de Graph) n’est pas une erreur ; assignedByGroup absent ou null : attribution directe', async () => {
    const { dir } = directoryWith([{ skuId: SKU, state: 'Active', error: 'None', assignedByGroup: null }]);
    expect((await dir.readLicenseStates('u', SKU)).entry).toEqual({ state: 'Active', error: null, assignedByGroup: null });
    const { dir: d2 } = directoryWith([{ skuId: SKU, state: 'Active', error: 'None' }]);
    expect((await d2.readLicenseStates('u', SKU)).entry?.assignedByGroup).toBeNull();
  });

  it('ignore les autres SKU mais les compte dans total ; aucune entrée du SKU : entry null', async () => {
    const { dir } = directoryWith([{ skuId: OTHER_SKU, state: 'Active', error: 'None', assignedByGroup: GROUP }]);
    expect(await dir.readLicenseStates('u', SKU)).toEqual({ entry: null, total: 1 });
    const { dir: vide } = directoryWith(undefined);
    expect(await vide.readLicenseStates('u', SKU)).toEqual({ entry: null, total: 0 });
  });

  it('plusieurs entrées du SKU (directe en erreur, groupe Active) : l’entrée Active sans erreur l’emporte', async () => {
    const { dir } = directoryWith([
      { skuId: SKU, state: 'Error', error: 'CountViolation', assignedByGroup: null },
      { skuId: SKU, state: 'Active', error: 'None', assignedByGroup: GROUP },
    ]);
    expect(await dir.readLicenseStates('u', SKU)).toEqual({ entry: { state: 'Active', error: null, assignedByGroup: GROUP }, total: 2 });
  });

  it('sans entrée Active, la première entrée du SKU est renvoyée avec son erreur', async () => {
    const { dir } = directoryWith([{ skuId: SKU, state: 'Error', error: 'CountViolation', assignedByGroup: GROUP }]);
    expect((await dir.readLicenseStates('u', SKU)).entry).toEqual({ state: 'Error', error: 'CountViolation', assignedByGroup: GROUP });
  });
});
