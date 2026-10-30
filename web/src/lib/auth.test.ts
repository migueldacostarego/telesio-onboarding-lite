import { describe, expect, it } from 'vitest';
import { LOGIN_URL, LOGOUT_URL, initials } from '@/lib/auth';

describe('initials', () => {
  it.each([
    ['Camille Exemple', 'CE'],
    ['camille exemple', 'CE'],
    ['Jean-Pierre Martin', 'JM'],
    ['Anne de la Tour', 'AT'],
    ['Madonna', 'M'],
    ['  Élodie   Durand ', 'ÉD'],
  ])('%s -> %s', (nom, attendu) => {
    expect(initials(nom)).toBe(attendu);
  });

  it('à défaut de nom, utilise l’email', () => {
    expect(initials('', 'camille.exemple@exemple.test')).toBe('CE');
    expect(initials('', 'camille@exemple.test')).toBe('C');
  });

  it('à défaut de tout, « ? »', () => {
    expect(initials('')).toBe('?');
    expect(initials('  ', null)).toBe('?');
  });
});

it('la déconnexion revient sur le front, avec une adresse fixe', () => {
  expect(LOGOUT_URL).toBe('/.auth/logout?post_logout_redirect_uri=/app/');
});

it('la reconnexion passe par le front : sans session, Easy Auth renvoie vers la connexion Microsoft', () => {
  expect(LOGIN_URL).toBe('/app/');
});
