import { TelemetryClient } from 'applicationinsights';

export type AuditValue = string | number | boolean;

export interface AuditEvent {
  /** Quoi : ex. demande.compte_cree */
  action: string;
  /** Qui : objectId Entra de l'acteur (jamais nom ni email). */
  actor?: string;
  outcome: 'ok' | 'refuse' | 'erreur';
  /** Contexte technique non sensible : identifiants d'objet, étape, code d'erreur… */
  [key: string]: AuditValue | undefined;
}

export interface Audit {
  track(event: AuditEvent): void;
  /**
   * Mesure numérique (Application Insights : table customMetrics), hors du journal d'audit : pour ce qui se répète sans
   * raconter une action (bilan d'un passage périodique). Un nom et un nombre, jamais de donnée de compte.
   */
  metric(name: string, value: number): void;
  flush(): Promise<void>;
}

/**
 * Coupe toute auto-collecte, à appeler avant le premier envoi (la bibliothèque lit ces réglages à ce moment-là). Sans cela,
 * `applicationinsights` 3.x active par défaut l'instrumentation HTTP et du SDK Azure (requêtes entrantes et appels Graph avec leurs
 * URL : recherche annuaire, filtres avec UPN), les exceptions, les compteurs de performance et les mesures en direct.
 */
export function reglerTelemetrie(client: TelemetryClient): void {
  const c = client.config;
  c.enableAutoCollectRequests = false;
  c.enableAutoCollectDependencies = false; // avec les requêtes à false : instrumentation HTTP désactivée
  c.enableAutoCollectExceptions = false;
  c.enableAutoCollectPerformance = false;
  c.enableAutoCollectExternalLoggers = false;
  c.azureMonitorOpenTelemetryOptions = {
    enableLiveMetrics: false,
    // Remplace la liste par défaut : aucune instrumentation de bibliothèque (le SDK Azure inclus).
    instrumentationOptions: {
      http: { enabled: false },
      azureSdk: { enabled: false },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      postgreSql: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
    },
  };
}

/**
 * Seuls des événements explicites partent vers Application Insights : l'auto-collecte est coupée (reglerTelemetrie), car
 * elle enregistrerait les URL (recherche annuaire, filtres Graph avec UPN), donc des données personnelles.
 */
export function createAudit(env: NodeJS.ProcessEnv = process.env): Audit {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    return {
      track: (e) => console.log(JSON.stringify({ at: new Date().toISOString(), ...e })),
      metric: (name, value) => console.log(JSON.stringify({ at: new Date().toISOString(), metric: name, value })),
      flush: async () => {},
    };
  }
  const client = new TelemetryClient(connectionString);
  reglerTelemetrie(client);
  return {
    track({ action, ...props }) {
      const properties: Record<string, string> = { at: new Date().toISOString() };
      for (const [k, v] of Object.entries(props)) if (v !== undefined) properties[k] = String(v);
      client.trackEvent({ name: action, properties });
    },
    metric: (name, value) => client.trackMetric({ name, value }),
    flush: () => client.flush(),
  };
}
