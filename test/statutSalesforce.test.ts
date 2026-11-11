import { describe, expect, it } from 'vitest';
import { loadConfig, parseSalesforceServicePrincipalId } from '../src/config';
import { dernierProvisionnement } from '../src/directory';
import { etatDe } from '../src/statutSalesforce';

describe('SALESFORCE_SERVICE_PRINCIPAL_ID', () => {
  it('facultatif, GUID en minuscules, refusé sinon', () => {
    expect(loadConfig({}).salesforceServicePrincipalId).toBeUndefined();
    expect(parseSalesforceServicePrincipalId(' E6218F0D-E494-4713-8DCB-A65DB55AFC98 ')).toBe('e6218f0d-e494-4713-8dcb-a65db55afc98');
    expect(() => parseSalesforceServicePrincipalId('salesforce')).toThrow('SALESFORCE_SERVICE_PRINCIPAL_ID invalide (attendu : GUID)');
  });
});

describe('dernierProvisionnement', () => {
  it('prend l’entrée la plus récente, quel que soit l’ordre rendu par Graph', () => {
    const e = dernierProvisionnement([
      { activityDateTime: '2026-11-10T17:01:00Z', provisioningStatusInfo: { status: 'skipped' } },
      { activityDateTime: '2026-11-10T17:28:58Z', provisioningStatusInfo: { status: 'success' } },
      { provisioningStatusInfo: { status: 'failure' } },
    ]);
    expect(e).toEqual({ statut: 'success', le: '2026-11-10T17:28:58Z', raison: null });
  });

  it('raison : celle de l’erreur, sinon la description de l’étape sautée ou en échec ; aucune entrée : null', () => {
    expect(dernierProvisionnement([{ activityDateTime: 'a', provisioningStatusInfo: { status: 'failure', errorInformation: { reason: ' Refus ' } } }])?.raison).toBe('Refus');
    expect(dernierProvisionnement([{ activityDateTime: 'a', provisioningStatusInfo: { status: 'skipped' }, provisioningSteps: [{ status: 'success', description: 'ok' }, { status: 'skipped', description: 'Inactif' }] }])?.raison).toBe('Inactif');
    expect(dernierProvisionnement([])).toBeNull();
  });
});

describe('etatDe', () => {
  const e = (statut: string) => ({ statut, le: 'x', raison: null });
  it.each([
    [false, e('success'), 'hors_perimetre'],
    [null, e('success'), 'illisible'],
    [true, undefined, 'illisible'],
    [true, null, 'en_attente'],
    [true, e('skipped'), 'en_attente'],
    [true, e('failure'), 'ko'],
    [true, e('success'), 'ok'],
    [true, e('warning'), 'ok'],
  ] as const)('membre %s, entrée %j : %s', (membre, entree, attendu) => {
    expect(etatDe(membre, entree)).toBe(attendu);
  });
});
