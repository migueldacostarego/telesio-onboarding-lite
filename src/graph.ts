import { DefaultAzureCredential, ManagedIdentityCredential, type TokenCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

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

export function createGraphClient(): Client {
  const authProvider = new TokenCredentialAuthenticationProvider(createCredential(), {
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return Client.initWithMiddleware({ authProvider });
}
