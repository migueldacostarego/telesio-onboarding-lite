import { describe, expect, it } from 'vitest';
import type { EtatLigne } from '@/lib/actions';
import {
  chronologie,
  jalonActivee,
  jalonAuthenticator,
  jalonCreee,
  jalonMotDePasse,
  jalonRegeneration,
  jalonTerminee,
  jalonValidee,
  type EntreeChronologie,
} from '@/lib/chronologie';
import type { DemandeDetail, Historique } from '@/lib/detail';

const T = '2026-10-29T08:00:00Z';
const camille = { nom: 'Camille' };

const historique = (o: Partial<Historique> = {}): Historique => ({
  enregistre: true,
  creation: { le: T, par: camille },
  validation: null,
  activation: null,
  regeneration: null,
  authenticator: null,
  motDePasse: null,
  termine: null,
  ...o,
});

type Surcharge = Partial<Omit<EntreeChronologie, 'detail'>> & { historique?: Partial<Historique>; dateArrivee?: string | null };
const entree = ({ historique: h, dateArrivee = null, etape = 1, actions = [], ...reste }: Surcharge = {}): EntreeChronologie => ({
  detail: { dateArrivee, historique: historique(h) } as DemandeDetail,
  etape,
  onboarding: undefined,
  actions,
  ...reste,
});

const enCours = (action: 'valider' | 'activer' | 'reprendre'): EtatLigne => ({ phase: 'en_cours', action });
const erreur = (action: 'valider' | 'activer' | 'reprendre' | 'refuser'): EtatLigne => ({ phase: 'erreur', action, error: new Error('échec') });

describe('jalonCreee', () => {
  it('est toujours fait, avec la date et l’auteur de la création', () => {
    expect(jalonCreee(entree())).toEqual({ cle: 'creee', titre: 'Demande créée', etat: 'fait', le: T, par: 'Camille' });
  });

  it('dit que l’auteur n’est pas enregistré quand il est inconnu, sans rien inventer', () => {
    const j = jalonCreee(entree({ historique: { creation: { le: null, par: null } } }));
    expect(j).toMatchObject({ etat: 'fait', le: null, detail: 'Auteur non enregistré.' });
    expect(j.par).toBeUndefined();
  });

  it('nomme un compte supprimé ou la tâche du serveur, sans mention d’auteur manquant', () => {
    const supprime = jalonCreee(entree({ historique: { creation: { le: T, par: { nom: null } } } }));
    expect(supprime.par).toBe('un compte supprimé');
    expect(supprime.detail).toBeUndefined();
    const serveur = jalonCreee(entree({ historique: { creation: { le: T, par: { nom: null, systeme: true } } } }));
    expect(serveur.par).toBe('le serveur (automatiquement)');
  });
});

describe('jalonValidee', () => {
  it('attend la direction à l’étape 1, sans date ni auteur', () => {
    const j = jalonValidee(entree({ etape: 1 }));
    expect(j).toEqual({ cle: 'validee', titre: 'Validée par la direction', etat: 'en_cours', detail: 'En attente de la direction.' });
    expect(j).not.toHaveProperty('le');
    expect(j).not.toHaveProperty('par');
  });

  it.each([
    [{ phase: 'compte_en_creation' } as EtatLigne, 'Compte en cours de création : nouvel essai automatique.'],
    [{ phase: 'licence_en_cours' } as EtatLigne, 'Licence en cours d’attribution : revalidation automatique.'],
    [{ phase: 'licence_lente' } as EtatLigne, 'La licence tarde à être attribuée : revalider dans quelques minutes.'],
    [enCours('valider'), 'En attente de la direction.'],
    [erreur('activer'), 'En attente de la direction.'],
  ])('à l’étape 1, l’issue %j donne « %s » sans échec', (etat, detail) => {
    expect(jalonValidee(entree({ etape: 1, etat }))).toMatchObject({ etat: 'en_cours', detail });
  });

  it('passe en échec à l’étape 1 quand la validation vient d’échouer', () => {
    expect(jalonValidee(entree({ etape: 1, etat: erreur('valider') }))).toMatchObject({
      etat: 'echec',
      detail: 'La validation a échoué : voir le message, puis réessayer.',
    });
  });

  it('est faite dès l’étape 2, avec la date et l’auteur de la validation', () => {
    const j = jalonValidee(entree({ etape: 2, historique: { validation: { le: T, par: camille } } }));
    expect(j).toMatchObject({ etat: 'fait', le: T, par: 'Camille' });
    expect(j.detail).toBeUndefined();
  });

  it('dit « date non enregistrée » (le: null) pour une validation faite avant l’historique', () => {
    const j = jalonValidee(entree({ etape: 3 }));
    expect(j).toMatchObject({ etat: 'fait', le: null });
    expect(j.par).toBeUndefined();
  });

  it('reste en échec à l’étape 2 tant que le dossier SharePoint manque (action reprendre proposée)', () => {
    expect(jalonValidee(entree({ etape: 2, actions: ['reprendre'] }))).toMatchObject({
      etat: 'echec',
      detail: 'Le dossier SharePoint n’a pas été créé : réessayer.',
    });
  });

  it('suit la reprise du dossier : en cours, puis nouvelle tentative échouée', () => {
    expect(jalonValidee(entree({ etape: 2, actions: ['reprendre'], etat: enCours('reprendre') }))).toMatchObject({
      etat: 'en_cours',
      detail: 'Création du dossier en cours.',
    });
    expect(jalonValidee(entree({ etape: 2, actions: ['reprendre'], etat: erreur('reprendre') }))).toMatchObject({
      etat: 'echec',
      detail: 'La nouvelle tentative a échoué : voir le message, puis réessayer.',
    });
  });

  it('ignore la reprise hors de l’étape 2 ou sans l’action reprendre', () => {
    expect(jalonValidee(entree({ etape: 3, actions: ['reprendre'] }))).toMatchObject({ etat: 'fait' });
    expect(jalonValidee(entree({ etape: 2, actions: [], etat: erreur('reprendre') }))).toMatchObject({ etat: 'fait' });
  });
});

describe('jalonActivee', () => {
  it('est à venir avant la validation, sans détail', () => {
    const j = jalonActivee(entree({ etape: 1 }));
    expect(j).toEqual({ cle: 'activee', titre: 'Compte activé', etat: 'a_venir' });
  });

  it('est en cours à l’étape 2 et annonce la date d’arrivée', () => {
    expect(jalonActivee(entree({ etape: 2, dateArrivee: '2026-11-03' }))).toMatchObject({
      etat: 'en_cours',
      detail: 'À activer le jour de l’arrivée (3 nov. 2026).',
    });
  });

  it('le dit quand la date d’arrivée manque', () => {
    expect(jalonActivee(entree({ etape: 2, dateArrivee: null }))).toMatchObject({
      etat: 'en_cours',
      detail: 'À activer le jour de l’arrivée (date non renseignée).',
    });
  });

  it('passe en échec quand l’activation vient d’échouer, mais pas pour un autre échec', () => {
    expect(jalonActivee(entree({ etape: 2, etat: erreur('activer') }))).toMatchObject({
      etat: 'echec',
      detail: 'L’activation a échoué : voir le message, puis réessayer.',
    });
    expect(jalonActivee(entree({ etape: 2, etat: erreur('valider') }))).toMatchObject({ etat: 'en_cours' });
  });

  it('est faite dès l’étape 3, avec la date et l’auteur, ou « non enregistrée »', () => {
    expect(jalonActivee(entree({ etape: 3, historique: { activation: { le: T, par: camille } } }))).toMatchObject({ etat: 'fait', le: T, par: 'Camille' });
    const ancien = jalonActivee(entree({ etape: 4 }));
    expect(ancien).toMatchObject({ etat: 'fait', le: null });
    expect(ancien.par).toBeUndefined();
    expect(ancien.detail).toBeUndefined();
  });
});

describe('jalonRegeneration', () => {
  const regeneration = (nombre: number) => ({ regeneration: { le: T, par: camille, nombre } });

  it('n’existe pas avant l’activation, même si l’historique en porte une', () => {
    expect(jalonRegeneration(entree({ etape: 2, historique: regeneration(1) }))).toBeNull();
  });

  it('n’existe pas sans régénération', () => {
    expect(jalonRegeneration(entree({ etape: 3 }))).toBeNull();
  });

  it('est une sous-étape faite, avec la date et l’auteur de la dernière remise', () => {
    expect(jalonRegeneration(entree({ etape: 3, historique: regeneration(1) }))).toEqual({
      cle: 'regeneration',
      titre: 'Mot de passe régénéré',
      etat: 'fait',
      sous: true,
      le: T,
      par: 'Camille',
    });
  });

  it('compte les régénérations au-delà d’une', () => {
    expect(jalonRegeneration(entree({ etape: 4, historique: regeneration(3) }))?.titre).toBe('Mot de passe régénéré (3 fois, dernière remise)');
  });
});

describe('jalonAuthenticator', () => {
  it('n’existe pas avant l’activation', () => {
    expect(jalonAuthenticator(entree({ etape: 2 }))).toBeNull();
  });

  it('attend la première connexion à l’étape 3 quand rien n’est inscrit', () => {
    expect(jalonAuthenticator(entree({ etape: 3 }))).toEqual({
      cle: 'authenticator',
      titre: 'Authenticator inscrit',
      etat: 'a_venir',
      sous: true,
      detail: 'À la première connexion de l’arrivant.',
    });
  });

  it('est fait avec la date de l’historique', () => {
    const j = jalonAuthenticator(entree({ etape: 3, historique: { authenticator: { le: T } } }));
    expect(j).toMatchObject({ etat: 'fait', le: T });
    expect(j?.detail).toBeUndefined();
  });

  it('est fait sans date quand Entra n’en fournit pas, et le dit', () => {
    expect(jalonAuthenticator(entree({ etape: 3, historique: { authenticator: { le: null } } }))).toMatchObject({
      etat: 'fait',
      le: null,
      detail: 'Date non fournie par Entra.',
    });
  });

  it('est fait d’après la lecture de l’onboarding quand l’historique n’a rien', () => {
    const lu = { motDePasse: false, authenticator: true, termine: false };
    expect(jalonAuthenticator(entree({ etape: 3, onboarding: lu }))).toMatchObject({ etat: 'fait', le: null, detail: 'Date non fournie par Entra.' });
  });

  it('reste à venir quand la lecture dit que rien n’est inscrit', () => {
    const lu = { motDePasse: false, authenticator: false, termine: false };
    expect(jalonAuthenticator(entree({ etape: 3, onboarding: lu }))).toMatchObject({ etat: 'a_venir', detail: 'À la première connexion de l’arrivant.' });
  });

  it('passe en échec quand la lecture de l’onboarding est impossible', () => {
    expect(jalonAuthenticator(entree({ etape: 3, onboarding: { verification: 'echec' } }))).toMatchObject({
      etat: 'echec',
      detail: 'Lecture impossible : relue à la prochaine actualisation.',
    });
  });

  it('préfère l’historique à une lecture impossible', () => {
    expect(jalonAuthenticator(entree({ etape: 3, onboarding: { verification: 'echec' }, historique: { authenticator: { le: T } } }))).toMatchObject({ etat: 'fait', le: T });
  });

  it('est fait sans date à l’étape 4 quand rien n’a été enregistré', () => {
    const j = jalonAuthenticator(entree({ etape: 4 }));
    expect(j).toMatchObject({ etat: 'fait', le: null });
    expect(j?.detail).toBeUndefined();
  });

  it('signale la lecture impossible même à l’étape 4', () => {
    expect(jalonAuthenticator(entree({ etape: 4, onboarding: { verification: 'echec' } }))?.etat).toBe('echec');
  });
});

describe('jalonMotDePasse', () => {
  it('n’existe pas avant l’activation', () => {
    expect(jalonMotDePasse(entree({ etape: 1 }))).toBeNull();
  });

  it('suit l’inscription d’Authenticator à l’étape 3 quand rien n’est changé', () => {
    expect(jalonMotDePasse(entree({ etape: 3 }))).toEqual({
      cle: 'motDePasse',
      titre: 'Mot de passe changé par l’arrivant',
      etat: 'a_venir',
      sous: true,
      detail: 'Après l’inscription d’Authenticator.',
    });
  });

  it('est fait avec la date de l’historique', () => {
    expect(jalonMotDePasse(entree({ etape: 3, historique: { motDePasse: { le: T } } }))).toMatchObject({ etat: 'fait', le: T });
  });

  it('est fait sans date d’après la lecture de l’onboarding', () => {
    const lu = { motDePasse: true, authenticator: true, termine: false };
    expect(jalonMotDePasse(entree({ etape: 3, onboarding: lu }))).toMatchObject({ etat: 'fait', le: null });
  });

  it('reste à venir sans explication quand la lecture est impossible', () => {
    const j = jalonMotDePasse(entree({ etape: 3, onboarding: { verification: 'echec' } }));
    expect(j?.etat).toBe('a_venir');
    expect(j?.detail).toBeUndefined();
  });

  it('est fait sans date à l’étape 4 quand rien n’a été enregistré', () => {
    expect(jalonMotDePasse(entree({ etape: 4 }))).toMatchObject({ etat: 'fait', le: null });
    expect(jalonMotDePasse(entree({ etape: 4, onboarding: { verification: 'echec' } }))).toMatchObject({ etat: 'fait', le: null });
  });
});

describe('jalonTerminee', () => {
  it.each([1, 2] as const)('est à venir à l’étape %i, sans détail', (etape) => {
    expect(jalonTerminee(entree({ etape }))).toEqual({ cle: 'terminee', titre: 'Onboarding terminé', etat: 'a_venir' });
  });

  it('est en cours à l’étape 3 tant que l’arrivant n’a pas fini', () => {
    const j = jalonTerminee(entree({ etape: 3, onboarding: { motDePasse: true, authenticator: false, termine: false } }));
    expect(j.etat).toBe('en_cours');
    expect(j.detail).toBeUndefined();
    expect(jalonTerminee(entree({ etape: 3 })).etat).toBe('en_cours');
  });

  it('annonce le passage automatique à Terminé quand tout est fait', () => {
    expect(jalonTerminee(entree({ etape: 3, onboarding: { motDePasse: true, authenticator: true, termine: true } }))).toMatchObject({
      etat: 'en_cours',
      detail: 'Tout est fait : le serveur passe le compte à Terminé automatiquement (vérification toutes les 5 minutes).',
    });
  });

  it('passe en échec quand l’état de l’onboarding n’a pas pu être lu', () => {
    expect(jalonTerminee(entree({ etape: 3, onboarding: { verification: 'echec' } }))).toMatchObject({
      etat: 'echec',
      detail: 'L’état du mot de passe et d’Authenticator n’a pas pu être lu : il sera relu à la prochaine actualisation.',
    });
  });

  it('est faite à l’étape 4, avec la date et l’auteur (la tâche du serveur)', () => {
    const j = jalonTerminee(entree({ etape: 4, historique: { termine: { le: T, par: { nom: null, systeme: true } } } }));
    expect(j).toMatchObject({ etat: 'fait', le: T, par: 'le serveur (automatiquement)' });
    expect(j.detail).toBeUndefined();
  });

  it('dit « date non enregistrée » (le: null) pour un compte terminé avant l’historique', () => {
    const j = jalonTerminee(entree({ etape: 4 }));
    expect(j).toMatchObject({ etat: 'fait', le: null });
    expect(j.par).toBeUndefined();
  });

  it('ignore l’onboarding à l’étape 4', () => {
    expect(jalonTerminee(entree({ etape: 4, onboarding: { verification: 'echec' } })).etat).toBe('fait');
  });
});

describe('chronologie', () => {
  const cles = (e: EntreeChronologie) => chronologie(e).map((j) => j.cle);

  it.each([1, 2] as const)('n’a que quatre jalons à l’étape %i, sans sous-étapes de l’arrivant', (etape) => {
    expect(cles(entree({ etape }))).toEqual(['creee', 'validee', 'activee', 'terminee']);
  });

  it('ajoute Authenticator puis le mot de passe à l’étape 3, avant « terminé »', () => {
    expect(cles(entree({ etape: 3 }))).toEqual(['creee', 'validee', 'activee', 'authenticator', 'motDePasse', 'terminee']);
  });

  it('range la régénération sous « activée », avant les sous-étapes de l’arrivant', () => {
    const e = entree({ etape: 3, historique: { regeneration: { le: T, par: camille, nombre: 2 } } });
    expect(cles(e)).toEqual(['creee', 'validee', 'activee', 'regeneration', 'authenticator', 'motDePasse', 'terminee']);
  });

  it('assemble le parcours complet d’un compte terminé, jalon par jalon', () => {
    const e = entree({
      etape: 4,
      historique: {
        validation: { le: '2026-10-29T09:00:00Z', par: { nom: 'Dominique' } },
        activation: { le: '2026-10-30T07:00:00Z', par: camille },
        authenticator: { le: '2026-10-30T07:10:00Z' },
        motDePasse: { le: '2026-10-30T07:12:00Z' },
        termine: { le: '2026-10-30T07:15:00Z', par: { nom: null, systeme: true } },
      },
    });
    expect(chronologie(e)).toEqual([
      { cle: 'creee', titre: 'Demande créée', etat: 'fait', le: T, par: 'Camille' },
      { cle: 'validee', titre: 'Validée par la direction', etat: 'fait', le: '2026-10-29T09:00:00Z', par: 'Dominique' },
      { cle: 'activee', titre: 'Compte activé', etat: 'fait', le: '2026-10-30T07:00:00Z', par: 'Camille' },
      { cle: 'authenticator', titre: 'Authenticator inscrit', etat: 'fait', sous: true, le: '2026-10-30T07:10:00Z' },
      { cle: 'motDePasse', titre: 'Mot de passe changé par l’arrivant', etat: 'fait', sous: true, le: '2026-10-30T07:12:00Z' },
      { cle: 'terminee', titre: 'Onboarding terminé', etat: 'fait', le: '2026-10-30T07:15:00Z', par: 'le serveur (automatiquement)' },
    ]);
  });
});
