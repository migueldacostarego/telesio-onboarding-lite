import { describe, expect, it } from 'vitest';
import { erreurEmail, normaliserPartie, proposerEmail } from '@/lib/email';

/** Mêmes cas que test/app.test.ts (« UPN ») : la proposition du formulaire suit la règle du serveur (src/upn.ts). */
const CAS_PARTIES: [string, string][] = [
  ['Éloïse', 'eloise'],
  ["D'Artagnan Œuvre", 'dartagnanoeuvre'],
  ['D’Artagnan', 'dartagnan'],
  ['Jean-Pierre', 'jean-pierre'],
  ['De La Cruz', 'delacruz'],
  ['Ærø Straße', 'aerostrasse'],
  ['  --Anne--Marie--  ', 'anne-marie'],
  ['日本', ''],
];

describe('normaliserPartie', () => {
  it.each(CAS_PARTIES)('%j → %j', (entree, attendu) => {
    expect(normaliserPartie(entree)).toBe(attendu);
  });
});

describe('proposerEmail', () => {
  it('prenom.nom@domaine, comme l’identifiant attribué par le serveur', () => {
    expect(proposerEmail('Jean-Pierre', 'De La Cruz', 'exemple.test')).toBe('jean-pierre.delacruz@exemple.test');
    expect(proposerEmail('Éloïse', "D'Artagnan", 'exemple.test')).toBe('eloise.dartagnan@exemple.test');
  });

  it('vide tant qu’il manque une lettre au prénom ou au nom, ou le domaine', () => {
    expect(proposerEmail('', 'Durand', 'exemple.test')).toBe('');
    expect(proposerEmail('Camille', '日本', 'exemple.test')).toBe('');
    expect(proposerEmail('Camille', 'Durand', '')).toBe('');
  });
});

describe('erreurEmail', () => {
  it('accepte une adresse du domaine, y compris le tiret et le point', () => {
    expect(erreurEmail('jean-pierre.delacruz2@exemple.test', 'exemple.test')).toBeNull();
  });

  it.each(['', 'camille', 'a@b@exemple.test', 'camille@autre.test', 'camillé@exemple.test', 'a..b@exemple.test', '.a@exemple.test', 'a-@exemple.test', `${'a'.repeat(65)}@exemple.test`])('refuse %j', (e) => {
    expect(erreurEmail(e, 'exemple.test')).not.toBeNull();
  });
});
