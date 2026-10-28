import { DefaultAzureCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

/**
 * Client Graph authentifié par DefaultAzureCredential :
 * identité managée sur App Service, `az login` en local. Aucun secret.
 */
export function createGraphClient(): Client {
  const credential = new DefaultAzureCredential();
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return Client.initWithMiddleware({ authProvider });
}
