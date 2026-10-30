import { afterEach, describe, expect, it } from 'vitest';
import { arriveeRelative, ecartJours, formatInstant, jourAParis } from '@/lib/dates';
import { formatArrivee } from '@/lib/suivi';

const TZ_INITIAL = process.env.TZ;
afterEach(() => {
  if (TZ_INITIAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_INITIAL;
});

describe('heure de Paris', () => {
  it('un instant UTC s’affiche en heure de Paris, été (UTC+2) et hiver (UTC+1)', () => {
    expect(formatInstant('2026-07-14T12:00:00Z')).toBe('14 juil. 2026 à 14:00');
    expect(formatInstant('2026-12-01T12:00:00Z')).toBe('1 déc. 2026 à 13:00');
    // Passage à l'heure d'hiver, dimanche 25 octobre 2026 à 3 h : 00:30 UTC est 02:30 (été), 01:30 UTC est 02:30 (hiver).
    expect(formatInstant('2026-10-25T00:30:00Z')).toBe('25 oct. 2026 à 02:30');
    expect(formatInstant('2026-10-25T01:30:00Z')).toBe('25 oct. 2026 à 02:30');
    expect(formatInstant('2026-10-25T21:30:00Z')).toBe('25 oct. 2026 à 22:30');
    // Le jour peut changer : 23 h UTC l'été est déjà le lendemain à Paris.
    expect(formatInstant('2026-07-14T22:30:00Z')).toBe('15 juil. 2026 à 00:30');
  });

  it('le fuseau du navigateur ne change rien (instants, jour du jour, date d’arrivée sans heure)', () => {
    const lire = () => [formatInstant('2026-10-28T07:00:00Z'), jourAParis(new Date('2026-10-28T22:30:00Z')), formatArrivee('2026-11-03'), arriveeRelative('2026-11-03', '2026-10-28')];
    const attendu = ['28 oct. 2026 à 08:00', '2026-10-28', '3 nov. 2026', 'Dans 6 j'];
    for (const tz of ['Europe/Paris', 'America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
      process.env.TZ = tz;
      expect(lire(), tz).toEqual(attendu);
    }
  });

  it('date illisible : dite, jamais « Invalid Date »', () => {
    expect(formatInstant('pas une date')).toBe('Date illisible');
  });

  it('écart et libellé relatif d’une date d’arrivée', () => {
    expect(ecartJours('2026-11-03', '2026-10-30')).toBe(4);
    expect(ecartJours('2026-03-30', '2026-03-28')).toBe(2); // passage à l'heure d'été : aucun décalage d'un jour
    expect([0, 1, -1, 5, -3].map((n) => arriveeRelative(new Date(Date.UTC(2026, 9, 30 + n)).toISOString().slice(0, 10), '2026-10-30'))).toEqual(['Aujourd’hui', 'Demain', 'Hier', 'Dans 5 j', 'Il y a 3 j']);
    expect(arriveeRelative(null, '2026-10-30')).toBeNull();
  });
});
