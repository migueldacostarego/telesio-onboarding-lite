import { DefaultAzureCredential, ManagedIdentityCredential, type AccessToken, type GetTokenOptions, type TokenCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import type { Audit } from './audit';
import { decodeTokenInfo, recordTokenInfo, tokenAuditProps } from './tokenRoles';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/**
 * Sur App Service (IDENTITY_ENDPOINT présent) : ManagedIdentityCredential visé sur AZURE_CLIENT_ID, sans la chaîne
 * DefaultAzureCredential (qui essaie d'abord EnvironmentCredential et journalise une exception à chaque jeton).
 * En local : DefaultAzureCredential (`az login`). Aucun secret.
 */
export function createCredential(env: NodeJS.ProcessEnv = process.env): TokenCredential {
  if (env.IDENTITY_ENDPOINT || env.MSI_ENDPOINT) {
    const clientId = env.AZURE_CLIENT_ID;
    if (!clientId) throw new Error('AZURE_CLIENT_ID requis sur App Service : l’identité managée est affectée par l’utilisateur');
    return new ManagedIdentityCredential({ clientId });
  }
  return new DefaultAzureCredential();
}

/**
 * Observe les jetons obtenus : mémorise les rôles du dernier (voir tokenRoles) et émet `graph.jeton` à chaque nouveau jeton
 * (instant d'émission différent), donc au démarrage puis à chaque renouvellement.
 */
export function observeCredential(inner: TokenCredential, audit: Audit): TokenCredential {
  let lastIssuedAt: string | undefined;
  return {
    async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken | null> {
      const token = await inner.getToken(scopes, options);
      if (token) {
        const info = decodeTokenInfo(token.token);
        recordTokenInfo(info);
        if (info && info.issuedAt !== lastIssuedAt) {
          lastIssuedAt = info.issuedAt;
          audit.track({ action: 'graph.jeton', outcome: 'ok', ...tokenAuditProps(info) });
        }
      }
      return token;
    },
  };
}

/** `warmUp` obtient un premier jeton au démarrage pour tracer ses rôles ; un échec n'empêche pas le démarrage. */
export function createGraphClient(audit: Audit, credential: TokenCredential = createCredential()): { client: Client; warmUp: () => Promise<void> } {
  const observed = observeCredential(credential, audit);
  const authProvider = new TokenCredentialAuthenticationProvider(observed, { scopes: [GRAPH_SCOPE] });
  return {
    client: Client.initWithMiddleware({ authProvider }),
    warmUp: async () => {
      try {
        await observed.getToken(GRAPH_SCOPE);
      } catch (err) {
        audit.track({ action: 'graph.jeton', outcome: 'erreur', code: (err as { name?: string })?.name });
      }
    },
  };
}
