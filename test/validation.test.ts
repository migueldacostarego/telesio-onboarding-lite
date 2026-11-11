import { describe, expect, it } from 'vitest';
import { erreurDateArrivee, erreursIdentite, lireChampsTexte, lireEmail, validateDemande } from '../src/validation';

const TODAY = '2026-11-01';
const DOMAIN = 'telesio.test';
const MANAGER = '0123abcd-0123-4abc-8123-0123456789ab';

const valide = {
  prenom: 'Camille',
  nom: 'Durand',
  dateArrivee: '2026-11-15',
  poste: 'Développeuse',
  service: 'Technique',
  managerId: MANAGER,
  typeContrat: 'Employé',
  pays: 'FR',
};
/** Valeur rendue : le trigramme est proposé d'après le prénom et le nom quand le client ne l'envoie pas. */
const rendu = { ...valide, trigramme: 'CDU' };

const run = (body: unknown) => validateDemande(body, TODAY, DOMAIN);
const details = (body: unknown) => {
  const v = run(body);
  if (v.ok) throw new Error('validation inattendue');
  return v.details;
};

describe('validateDemande : demande valide', () => {
  it('rend les champs nettoyés, dans l’ordre, sans email quand il est absent', () => {
    const v = run({ ...valide, prenom: '  Camille ', poste: 'Développeuse\t ' });
    expect(v).toEqual({ ok: true, value: rendu });
    if (v.ok) {
      expect(Object.keys(v.value)).toEqual(['prenom', 'nom', 'dateArrivee', 'poste', 'service', 'managerId', 'typeContrat', 'pays', 'trigramme']);
    }
  });

  it('ajoute l’email en minuscules quand il est valide', () => {
    const v = run({ ...valide, email: ' Camille.Durand@Telesio.test ' });
    expect(v).toEqual({ ok: true, value: { ...rendu, email: 'camille.durand@telesio.test' } });
    if (v.ok) expect(Object.keys(v.value).at(-1)).toBe('email');
  });

  it('accepte une arrivée aujourd’hui et un type Contractor', () => {
    expect(run({ ...valide, dateArrivee: TODAY, typeContrat: 'Contractor' })).toEqual({
      ok: true,
      value: { ...rendu, dateArrivee: TODAY, typeContrat: 'Contractor' },
    });
  });
});

describe('validateDemande : pays', () => {
  it('accepte Maurice, et pose France quand le client n’envoie pas de pays', () => {
    expect(run({ ...valide, pays: 'MU' })).toEqual({ ok: true, value: { ...rendu, pays: 'MU' } });
    const sansPays: Record<string, unknown> = { ...valide };
    delete sansPays.pays;
    expect(run(sansPays)).toEqual({ ok: true, value: { ...rendu, pays: 'FR' } });
  });

  it('refuse un pays hors liste', () => {
    for (const pays of ['', 'fr', 'France', 'BE', 42, null]) expect(details({ ...valide, pays })).toEqual({ pays: 'requis, parmi : FR, MU' });
  });
});

describe('validateDemande : trigramme', () => {
  it('rogne et met en majuscules le trigramme saisi, qui remplace la proposition', () => {
    expect(run({ ...valide, trigramme: ' cdr ' })).toEqual({ ok: true, value: { ...rendu, trigramme: 'CDR' } });
  });

  it.each([
    ['Camille', 'Durand', 'CDU'],
    ['Éloïse', 'de la Cruz', 'EDE'],
    ['Jean-Marc', "O'Neil", 'JON'],
    ['Ærin', 'Œuvre', 'AOE'],
  ])('propose %s %s : %s (mêmes cas que web/src/lib/trigramme.test.ts)', (prenom, nom, attendu) => {
    const v = run({ ...valide, prenom, nom });
    expect(v.ok && v.value.trigramme).toBe(attendu);
  });

  it('refuse un trigramme qui n’est pas fait de trois lettres A-Z', () => {
    for (const trigramme of ['', 'AB', 'ABCD', 'A1B', 'ÉLO', 42, null]) {
      expect(details({ ...valide, trigramme })).toEqual({ trigramme: 'trois lettres sans accent requises (A-Z)' });
    }
  });

  it('refuse un nom trop court pour proposer un trigramme, sans en envoyer', () => {
    expect(details({ ...valide, nom: 'O' })).toEqual({ trigramme: 'trois lettres sans accent requises (A-Z)' });
  });

  it('n’ajoute pas d’erreur de trigramme quand le prénom ou le nom est déjà refusé', () => {
    expect(Object.keys(details({ ...valide, nom: '' }))).toEqual(['nom']);
  });
});

describe('validateDemande : corps invalide', () => {
  it('traite un corps absent ou qui n’est pas un objet comme un objet vide', () => {
    const attendu = {
      prenom: 'requis, 64 caractères max',
      nom: 'requis, 64 caractères max',
      poste: 'requis, 128 caractères max',
      service: 'requis, 64 caractères max',
      dateArrivee: 'date valide au format AAAA-MM-JJ requise',
      managerId: 'objectId Entra (GUID) requis',
      typeContrat: 'requis, parmi : Employé, Contractor',
    };
    for (const body of [undefined, null, 'texte', 42]) {
      const d = details(body);
      expect(d).toEqual(attendu);
      expect(Object.keys(d)).toEqual(Object.keys(attendu));
    }
  });

  it('refuse un champ texte vide, trop long, non texte ou avec un caractère de contrôle', () => {
    const d = details({
      ...valide,
      prenom: '   ',
      nom: 'x'.repeat(65),
      poste: 12,
      service: 'Tech\u0000nique',
    });
    expect(d).toEqual({
      prenom: 'requis, 64 caractères max',
      nom: 'requis, 64 caractères max',
      poste: 'requis, 128 caractères max',
      service: 'requis, 64 caractères max',
    });
  });

  it('accepte les longueurs limites', () => {
    expect(run({ ...valide, prenom: 'a'.repeat(29), nom: 'b'.repeat(30), poste: 'p'.repeat(128), service: 's'.repeat(64) }).ok).toBe(true);
  });

  it('refuse une date mal formée, impossible ou passée', () => {
    expect(details({ ...valide, dateArrivee: '15/11/2026' })).toEqual({ dateArrivee: 'date valide au format AAAA-MM-JJ requise' });
    expect(details({ ...valide, dateArrivee: '2026-02-30' })).toEqual({ dateArrivee: 'date valide au format AAAA-MM-JJ requise' });
    expect(details({ ...valide, dateArrivee: 20261115 })).toEqual({ dateArrivee: 'date valide au format AAAA-MM-JJ requise' });
    expect(details({ ...valide, dateArrivee: '2026-10-31' })).toEqual({ dateArrivee: 'ne peut pas être dans le passé' });
  });

  it('refuse un managerId qui n’est pas un GUID', () => {
    expect(details({ ...valide, managerId: 'pas-un-guid' })).toEqual({ managerId: 'objectId Entra (GUID) requis' });
    expect(details({ ...valide, managerId: 42 })).toEqual({ managerId: 'objectId Entra (GUID) requis' });
  });

  it('refuse un type de contrat inconnu ou absent, et une licence envoyée', () => {
    expect(details({ ...valide, typeContrat: 'Stagiaire' })).toEqual({ typeContrat: 'requis, parmi : Employé, Contractor' });
    expect(details({ ...valide, licence: 'E3' })).toEqual({ licence: 'ne se choisit plus : elle dépend du type de contrat (typeContrat)' });
    expect(details({ ...valide, licence: null })).toEqual({ licence: 'ne se choisit plus : elle dépend du type de contrat (typeContrat)' });
  });

  it('refuse un email invalide avec le message de validerEmail', () => {
    expect(details({ ...valide, email: 'camille' })).toEqual({ email: 'adresse en @telesio.test requise' });
    expect(details({ ...valide, email: 'camille@autre.test' })).toEqual({ email: 'le domaine doit être telesio.test' });
    expect(details({ ...valide, email: 42 })).toEqual({ email: 'adresse en @telesio.test requise' });
    expect(details({ ...valide, email: null })).toEqual({ email: 'adresse en @telesio.test requise' });
  });
});

describe('validateDemande : identité', () => {
  it('refuse un prénom ou un nom sans lettre latine ni chiffre', () => {
    expect(details({ ...valide, prenom: '王' })).toEqual({ prenom: 'doit contenir au moins une lettre latine ou un chiffre' });
    expect(details({ ...valide, nom: '---' })).toEqual({ nom: 'doit contenir au moins une lettre latine ou un chiffre' });
    expect(details({ ...valide, prenom: '王', nom: '---' })).toEqual({
      prenom: 'doit contenir au moins une lettre latine ou un chiffre',
      nom: 'doit contenir au moins une lettre latine ou un chiffre',
    });
  });

  it('refuse un prénom et un nom trop longs pour former un identifiant, sur le nom', () => {
    expect(details({ ...valide, prenom: 'a'.repeat(40), nom: 'b'.repeat(40) })).toEqual({
      nom: 'prénom et nom trop longs pour former un identifiant (60 caractères max)',
    });
  });

  it('ne signale pas la longueur quand un des deux est déjà refusé', () => {
    expect(details({ ...valide, prenom: '王'.repeat(40), nom: 'b'.repeat(40) })).toEqual({
      prenom: 'doit contenir au moins une lettre latine ou un chiffre',
    });
  });

  it('ne vérifie pas l’identité quand prénom ou nom manque : seul le message « requis » reste', () => {
    expect(details({ ...valide, prenom: undefined, nom: '---' })).toEqual({ prenom: 'requis, 64 caractères max' });
  });
});

describe('validateDemande : ordre des erreurs', () => {
  it('suit l’ordre des vérifications : textes, identité, date, manager, type, licence, email', () => {
    const d = details({
      prenom: '王',
      nom: '---',
      dateArrivee: '2026-10-31',
      managerId: 'x',
      typeContrat: 'Autre',
      licence: 'E3',
      email: 'camille',
    });
    expect(Object.keys(d)).toEqual(['poste', 'service', 'prenom', 'nom', 'dateArrivee', 'managerId', 'typeContrat', 'licence', 'email']);
  });

  it('place les erreurs d’identité après celles de poste et service', () => {
    const d = details({ ...valide, prenom: '王', poste: undefined, service: undefined });
    expect(Object.keys(d)).toEqual(['poste', 'service', 'prenom']);
  });

  it('garde les messages « requis » avant ceux de l’identité quand un seul des deux manque', () => {
    const d = details({ ...valide, prenom: undefined, poste: undefined });
    expect(Object.keys(d)).toEqual(['prenom', 'poste']);
  });
});

describe('lireChampsTexte', () => {
  it('rend les valeurs nettoyées et aucune erreur quand tout est valide', () => {
    expect(lireChampsTexte({ prenom: '  Camille ', nom: 'Du   rand', poste: 'Dév', service: 'Tech' })).toEqual({
      valeurs: { prenom: 'Camille', nom: 'Du rand', poste: 'Dév', service: 'Tech' },
      erreurs: {},
    });
  });

  it('pose un message « requis » avec la limite du champ, dans l’ordre prénom, nom, poste, service', () => {
    const { valeurs, erreurs } = lireChampsTexte({ prenom: '', nom: 7, poste: 'x'.repeat(129), service: 'S\u0007' });
    expect(valeurs).toEqual({});
    expect(erreurs).toEqual({
      prenom: 'requis, 64 caractères max',
      nom: 'requis, 64 caractères max',
      poste: 'requis, 128 caractères max',
      service: 'requis, 64 caractères max',
    });
    expect(Object.keys(erreurs)).toEqual(['prenom', 'nom', 'poste', 'service']);
  });

  it('garde les valeurs valides à côté des champs refusés', () => {
    const { valeurs, erreurs } = lireChampsTexte({ prenom: 'Camille', poste: 'Dév' });
    expect(valeurs).toEqual({ prenom: 'Camille', poste: 'Dév' });
    expect(Object.keys(erreurs)).toEqual(['nom', 'service']);
  });
});

describe('erreursIdentite', () => {
  const LETTRE = 'doit contenir au moins une lettre latine ou un chiffre';

  it('ne rend aucune clé pour une identité valide', () => {
    expect(Object.keys(erreursIdentite('Camille', 'Durand'))).toEqual([]);
  });

  it('ne vérifie rien tant que le prénom ou le nom manque', () => {
    expect(erreursIdentite(undefined, '---')).toEqual({});
    expect(erreursIdentite('王', undefined)).toEqual({});
    expect(erreursIdentite(undefined, undefined)).toEqual({});
  });

  it('refuse un prénom, un nom ou les deux sans lettre latine ni chiffre', () => {
    expect(erreursIdentite('王', 'Durand')).toEqual({ prenom: LETTRE });
    expect(erreursIdentite('Camille', '---')).toEqual({ nom: LETTRE });
    const deux = erreursIdentite('王', '---');
    expect(deux).toEqual({ prenom: LETTRE, nom: LETTRE });
    expect(Object.keys(deux)).toEqual(['prenom', 'nom']);
  });

  it('refuse sur le nom un identifiant trop long, et l’accepte à la limite', () => {
    expect(erreursIdentite('a'.repeat(29), 'b'.repeat(30))).toEqual({});
    expect(erreursIdentite('a'.repeat(30), 'b'.repeat(30))).toEqual({
      nom: 'prénom et nom trop longs pour former un identifiant (60 caractères max)',
    });
  });

  it('ne signale pas la longueur quand le prénom ou le nom est déjà refusé', () => {
    expect(erreursIdentite('王'.repeat(40), 'b'.repeat(40))).toEqual({ prenom: LETTRE });
    expect(erreursIdentite('a'.repeat(40), '王'.repeat(40))).toEqual({ nom: LETTRE });
  });
});

describe('erreurDateArrivee', () => {
  it('rend undefined pour aujourd’hui et pour une date à venir', () => {
    expect(erreurDateArrivee(TODAY, TODAY)).toBeUndefined();
    expect(erreurDateArrivee('2027-02-28', TODAY)).toBeUndefined();
  });

  it('refuse une date vide, mal formée ou impossible', () => {
    const attendu = 'date valide au format AAAA-MM-JJ requise';
    expect(erreurDateArrivee('', TODAY)).toBe(attendu);
    expect(erreurDateArrivee('2026-1-5', TODAY)).toBe(attendu);
    expect(erreurDateArrivee('2026-13-01', TODAY)).toBe(attendu);
    expect(erreurDateArrivee('2026-02-29', TODAY)).toBe(attendu);
  });

  it('accepte le 29 février d’une année bissextile', () => {
    expect(erreurDateArrivee('2028-02-29', TODAY)).toBeUndefined();
  });

  it('refuse une date passée, y compris la veille', () => {
    expect(erreurDateArrivee('2026-10-31', TODAY)).toBe('ne peut pas être dans le passé');
    expect(erreurDateArrivee('2020-01-01', TODAY)).toBe('ne peut pas être dans le passé');
  });

  it('juge une date impossible avant de la comparer à today', () => {
    expect(erreurDateArrivee('2020-02-30', TODAY)).toBe('date valide au format AAAA-MM-JJ requise');
  });
});

describe('lireEmail', () => {
  it('ne rend ni adresse ni erreur quand l’email est absent', () => {
    expect(lireEmail(undefined, DOMAIN)).toEqual({});
  });

  it('rend l’adresse en minuscules, sans erreur, quand elle est valide', () => {
    const r = lireEmail(' Camille.Durand@Telesio.test ', DOMAIN);
    expect(r).toEqual({ email: 'camille.durand@telesio.test' });
    expect(Object.keys(r)).toEqual(['email']);
  });

  it('rend le message de validerEmail, sans adresse, quand elle est invalide', () => {
    expect(lireEmail('camille@autre.test', DOMAIN)).toEqual({ erreur: 'le domaine doit être telesio.test' });
    expect(lireEmail('camille', DOMAIN)).toEqual({ erreur: 'adresse en @telesio.test requise' });
    expect(lireEmail('', DOMAIN)).toEqual({ erreur: 'adresse en @telesio.test requise' });
  });

  it('refuse un email présent mais qui n’est pas une chaîne', () => {
    expect(lireEmail(null, DOMAIN)).toEqual({ erreur: 'adresse en @telesio.test requise' });
    expect(lireEmail(42, DOMAIN)).toEqual({ erreur: 'adresse en @telesio.test requise' });
  });
});
