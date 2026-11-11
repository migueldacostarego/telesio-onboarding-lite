import { describe, expect, it } from 'vitest';
import { proposerTrigramme } from '@/lib/trigramme';

describe('proposerTrigramme : mêmes cas que le serveur (test/validation.test.ts)', () => {
  it.each([
    ['Camille', 'Durand', 'CDU'],
    ['Éloïse', 'de la Cruz', 'EDE'],
    ['Jean-Marc', "O'Neil", 'JON'],
    ['Ærin', 'Œuvre', 'AOE'],
  ])('%s %s : %s', (prenom, nom, attendu) => {
    expect(proposerTrigramme(prenom, nom)).toBe(attendu);
  });

  it('vide tant que le prénom ou le nom ne donne pas assez de lettres', () => {
    expect(proposerTrigramme('', 'Durand')).toBe('');
    expect(proposerTrigramme('Camille', 'O')).toBe('');
    expect(proposerTrigramme('42', 'Durand')).toBe('');
  });
});
