import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { describe, expect, it } from 'vitest';
import { createCredential } from '../src/graph';

describe('createCredential', () => {
  const CLIENT_ID = '1eeac814-7c8f-439c-8690-caccdc076ca0';

  it('App Service : ManagedIdentityCredential visé sur AZURE_CLIENT_ID, sans la chaîne DefaultAzureCredential', () => {
    const c = createCredential({ IDENTITY_ENDPOINT: 'http://127.0.0.1:8081/msi/token', IDENTITY_HEADER: 'x', AZURE_CLIENT_ID: CLIENT_ID });
    expect(c).toBeInstanceOf(ManagedIdentityCredential);
    expect(c).not.toBeInstanceOf(DefaultAzureCredential);
  });

  it('App Service sans AZURE_CLIENT_ID : échec au démarrage', () => {
    expect(() => createCredential({ IDENTITY_ENDPOINT: 'http://127.0.0.1:8081/msi/token' })).toThrow(/AZURE_CLIENT_ID/);
  });

  it('local : DefaultAzureCredential (az login)', () => {
    expect(createCredential({})).toBeInstanceOf(DefaultAzureCredential);
  });
});
