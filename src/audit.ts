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
  flush(): Promise<void>;
}

/**
 * Seuls des événements explicites partent vers Application Insights.
 * L'auto-collecte HTTP/dépendances n'est volontairement pas activée : elle enregistrerait
 * les URL (recherche annuaire, filtres Graph avec UPN), donc des données personnelles.
 */
export function createAudit(env: NodeJS.ProcessEnv = process.env): Audit {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    return {
      track: (e) => console.log(JSON.stringify({ at: new Date().toISOString(), ...e })),
      flush: async () => {},
    };
  }
  const client = new TelemetryClient(connectionString);
  return {
    track({ action, ...props }) {
      const properties: Record<string, string> = { at: new Date().toISOString() };
      for (const [k, v] of Object.entries(props)) if (v !== undefined) properties[k] = String(v);
      client.trackEvent({ name: action, properties });
    },
    flush: () => client.flush(),
  };
}
