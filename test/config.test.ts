import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  parseArrivantsGroupId,
  parseExtension,
  parseFolderPattern,
  parseGraphId,
  parseTerminaisonInterval,
  parseTimeZone,
  parseUpnDomain,
} from '../src/config';

const EXT = 'extension_0123456789abcdef0123456789abcdef_statutOnboarding';

describe('parseExtension', () => {
  it('rend undefined pour une valeur absente ou vide', () => {
    expect(parseExtension(undefined, 'X')).toBeUndefined();
    expect(parseExtension('', 'X')).toBeUndefined();
    expect(parseExtension('   ', 'X')).toBeUndefined();
  });

  it('accepte une extension valide et retire les espaces autour', () => {
    expect(parseExtension(EXT, 'X')).toBe(EXT);
    expect(parseExtension(`  ${EXT}  `, 'X')).toBe(EXT);
  });

  it('cite la variable dans l’erreur d’une extension mal formée', () => {
    for (const bad of ['statutOnboarding', 'extension_abc_statut', 'extension_0123456789abcdef0123456789abcdef_', 'extension_0123456789abcdef0123456789abcdef_a-b']) {
      expect(() => parseExtension(bad, 'ENTRA_STATUS_EXTENSION')).toThrow(
        'ENTRA_STATUS_EXTENSION invalide (attendu : extension_<appId sans tirets>_<nom>)',
      );
    }
  });
});

describe('parseGraphId', () => {
  it('rend undefined pour une valeur absente ou vide', () => {
    expect(parseGraphId(undefined, 'X')).toBeUndefined();
    expect(parseGraphId(' ', 'X')).toBeUndefined();
  });

  it('accepte les ids de site et de drive de Graph', () => {
    const site = 'exemple.sharepoint.test,11111111-2222-4333-8444-555555555555,66666666-7777-4888-8999-000000000000';
    expect(parseGraphId(site, 'X')).toBe(site);
    expect(parseGraphId(' b!abc_DEF-123 ', 'X')).toBe('b!abc_DEF-123');
  });

  it('refuse ce qui sortirait du chemin d’API et cite la variable', () => {
    for (const bad of ['a/b', 'a b', 'a?x=1', '../x', 'a#b']) {
      expect(() => parseGraphId(bad, 'SHAREPOINT_SITE_ID')).toThrow('SHAREPOINT_SITE_ID invalide');
    }
  });
});

describe('parseUpnDomain', () => {
  it('rend undefined si absent, met en minuscules sinon', () => {
    expect(parseUpnDomain(undefined)).toBeUndefined();
    expect(parseUpnDomain('')).toBeUndefined();
    expect(parseUpnDomain(' Contoso.COM ')).toBe('contoso.com');
  });

  it('refuse ce qui n’est pas un nom de domaine', () => {
    for (const bad of ['contoso', 'contoso.c', '-a.com', 'a..com', 'a b.com', 'a@contoso.com']) {
      expect(() => parseUpnDomain(bad)).toThrow('UPN_DOMAIN invalide (attendu : un nom de domaine, ex. contoso.com)');
    }
  });
});

describe('parseFolderPattern', () => {
  it('prend le motif par défaut si absent', () => {
    expect(parseFolderPattern(undefined)).toBe('{nom} {prenom}');
    expect(parseFolderPattern('  ')).toBe('{nom} {prenom}');
  });

  it('accepte un motif valide, espaces retirés', () => {
    expect(parseFolderPattern(' {nom}-{id} ')).toBe('{nom}-{id}');
  });

  it('refuse un motif invalide en donnant la raison', () => {
    expect(() => parseFolderPattern('dossier')).toThrow(/^SHAREPOINT_FOLDER_PATTERN invalide : au moins un champ requis/);
    expect(() => parseFolderPattern('{inconnu}')).toThrow('champ inconnu {inconnu}');
    expect(() => parseFolderPattern('{nom} {')).toThrow('accolades non appariées');
    expect(() => parseFolderPattern(`{nom}${'x'.repeat(100)}`)).toThrow('100 caractères max');
  });
});

describe('parseArrivantsGroupId', () => {
  const guid = 'ffffffff-0000-4000-8000-0000000000a1';

  it('rend undefined si absent', () => {
    expect(parseArrivantsGroupId(undefined)).toBeUndefined();
    expect(parseArrivantsGroupId('')).toBeUndefined();
  });

  it('met le GUID en minuscules', () => {
    expect(parseArrivantsGroupId(` ${guid.toUpperCase()} `)).toBe(guid);
  });

  it('refuse ce qui n’est pas un GUID', () => {
    expect(() => parseArrivantsGroupId('pas-un-guid')).toThrow('ARRIVANTS_GROUP_ID invalide (attendu : GUID)');
  });
});

describe('parseTimeZone', () => {
  it('prend Europe/Paris si absent', () => {
    expect(parseTimeZone(undefined)).toBe('Europe/Paris');
    expect(parseTimeZone(' ')).toBe('Europe/Paris');
  });

  it('accepte un fuseau IANA', () => {
    expect(parseTimeZone('America/Montreal')).toBe('America/Montreal');
  });

  it('refuse un fuseau inconnu en le citant', () => {
    expect(() => parseTimeZone('Mars/Olympus')).toThrow('TZ_METIER invalide : "Mars/Olympus"');
  });
});

describe('parseTerminaisonInterval', () => {
  it('vaut 5 minutes si absent', () => {
    expect(parseTerminaisonInterval(undefined)).toBe(300_000);
    expect(parseTerminaisonInterval('')).toBe(300_000);
  });

  it('accepte 0 (désactivée) et les bornes 60 s et 24 h', () => {
    expect(parseTerminaisonInterval('0')).toBe(0);
    expect(parseTerminaisonInterval('60000')).toBe(60_000);
    expect(parseTerminaisonInterval('86400000')).toBe(86_400_000);
  });

  it('refuse négatif, trop court, trop long, non entier, non numérique', () => {
    for (const bad of ['-1', '1', '59999', '86400001', '2147483648', '1000.5', 'abc', 'Infinity', 'NaN']) {
      expect(() => parseTerminaisonInterval(bad)).toThrow(
        'TERMINAISON_INTERVAL_MS invalide (0 pour désactiver, sinon entre 60000 ms et 86400000 ms)',
      );
    }
  });
});

describe('loadConfig : ordre des vérifications', () => {
  // Plusieurs variables invalides à la fois : la première vérifiée donne l’erreur (comportement inchangé par le découpage).
  it('signale d’abord UPN_DOMAIN, puis ENTRA_STATUS_EXTENSION, puis SHAREPOINT_SITE_ID', () => {
    const env = { UPN_DOMAIN: 'x', ENTRA_STATUS_EXTENSION: 'x', SHAREPOINT_SITE_ID: 'a/b' };
    expect(() => loadConfig(env)).toThrow(/^UPN_DOMAIN invalide/);
    expect(() => loadConfig({ ...env, UPN_DOMAIN: 'exemple.test' })).toThrow(/^ENTRA_STATUS_EXTENSION invalide/);
    expect(() => loadConfig({ ...env, UPN_DOMAIN: 'exemple.test', ENTRA_STATUS_EXTENSION: EXT })).toThrow(/^SHAREPOINT_SITE_ID invalide/);
  });

  it('signale ENTRA_ACTIVATION_EXTENSION avant ENTRA_CREATOR_EXTENSION, et TZ_METIER avant TERMINAISON_INTERVAL_MS', () => {
    const bad = { ENTRA_ACTIVATION_EXTENSION: 'x', ENTRA_CREATOR_EXTENSION: 'x', TZ_METIER: 'Mars/Olympus', TERMINAISON_INTERVAL_MS: 'abc' };
    expect(() => loadConfig(bad)).toThrow(/^ENTRA_ACTIVATION_EXTENSION invalide/);
    expect(() => loadConfig({ ...bad, ENTRA_ACTIVATION_EXTENSION: EXT })).toThrow(/^ENTRA_CREATOR_EXTENSION invalide/);
    expect(() => loadConfig({ ...bad, ENTRA_ACTIVATION_EXTENSION: EXT, ENTRA_CREATOR_EXTENSION: EXT })).toThrow(/^TZ_METIER invalide/);
    expect(() => loadConfig({ TERMINAISON_INTERVAL_MS: 'abc' })).toThrow(/^TERMINAISON_INTERVAL_MS invalide/);
  });

  it('assemble la configuration par défaut', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 3000,
      rhRole: 'RH',
      directionRole: 'Direction',
      timeZone: 'Europe/Paris',
      trustAuthHeaders: false,
      sharePoint: { folderPattern: '{nom} {prenom}' },
      licenses: [],
      terminaisonIntervalMs: 300_000,
    });
    expect(c.history).toBeUndefined();
  });
});
