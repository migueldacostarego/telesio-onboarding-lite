import { TelemetryClient } from 'applicationinsights';
import { describe, expect, it, vi } from 'vitest';
import { createAudit, reglerTelemetrie } from '../src/audit';

const CONNEXION = 'InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=https://ingest.exemple.test/';

// L'auto-collecte d'Application Insights enregistrerait les URL (recherche annuaire, filtres Graph avec UPN) : seuls les événements
// explicites de audit.track doivent partir. Ces réglages sont ceux que la bibliothèque lit au premier envoi.
describe('télémétrie Application Insights : aucune auto-collecte', () => {
  const options = () => {
    const client = new TelemetryClient(CONNEXION);
    reglerTelemetrie(client);
    return client.config.parseConfig() as unknown as {
      enableAutoCollectExceptions: boolean;
      enablePerformanceCounters: boolean;
      enableLiveMetrics: boolean;
      instrumentationOptions: Record<string, { enabled?: boolean }>;
    };
  };

  it('requêtes et dépendances HTTP (donc URL, requêtes Graph) désactivées', () => {
    const o = options();
    expect(o.instrumentationOptions.http?.enabled).toBe(false);
    expect(o.instrumentationOptions.azureSdk?.enabled).toBe(false);
  });

  it('exceptions, compteurs de performance et mesures en direct désactivés', () => {
    const o = options();
    expect(o.enableAutoCollectExceptions).toBe(false);
    expect(o.enablePerformanceCounters).toBe(false);
    expect(o.enableLiveMetrics).toBe(false);
  });

  it('aucune instrumentation de bibliothèque restée active (journaux, bases de données)', () => {
    const actives = Object.entries(options().instrumentationOptions).filter(([, v]) => v?.enabled).map(([k]) => k);
    expect(actives).toEqual([]);
  });
});

describe('createAudit', () => {
  it('sans chaîne de connexion : JSON sur la console, jamais de client', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    createAudit({}).track({ action: 'x.y', actor: 'abc', outcome: 'ok' });
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ action: 'x.y', actor: 'abc', outcome: 'ok' });
    log.mockRestore();
  });
});
