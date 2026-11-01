import { describe, expect, it, vi } from 'vitest';
import type { ActivationDeps } from '../src/activation';
import { ServiceError } from '../src/demandes';
import type { DemandeLue, LicenseRead } from '../src/directory';
import {
  acteurDe,
  auteursDistincts,
  authenticatorPresent,
  createurDe,
  datesAuthenticator,
  dossierEtatDe,
  evenementsDe,
  extensionsALire,
  faitDe,
  groupeArrivantsDe,
  historiqueDe,
  libelleLicence,
  licenceDetail,
  lectureDouce,
  lireAuthenticator,
  lireDossier,
  lireGroupe,
  lireLicence,
  lireNoms,
  lireUtilisateur,
  nomDossierDe,
  onboardingDe,
  skuDe,
  statutDe,
  type Evenements,
  type Noms,
} from '../src/detail';
import { ACTEUR_SYSTEME, encoderEvenement } from '../src/history';
import { DIR_ID, EXT, EXT_ACT, EXT_CREATOR, EXT_LIC, HISTORY, RH_ID } from './helpers/ctx';

type Directory = ActivationDeps['directory'];
type Cfg = Parameters<typeof extensionsALire>[0];

const directory = (o: Partial<Record<keyof Directory, unknown>>) => o as unknown as Directory;
const cfg = (o: Record<string, unknown> = {}) => ({ statusExtension: EXT, ...o }) as unknown as Cfg;
const audit = () => ({ track: vi.fn(), metric: vi.fn(), flush: vi.fn() });
const quand = '2026-10-27T10:00:00.000Z';
const noms = (entries: Array<[string, string | null]> = []): Noms => new Map(entries);
const sansEvenements: Evenements = { validation: null, activation: null, regeneration: null, termine: null };

describe('extensionsALire', () => {
  it('statut et activation seulement quand rien d’autre n’est configuré', () => {
    expect(extensionsALire(cfg(), EXT_ACT)).toEqual([EXT, EXT_ACT]);
  });

  it('ajoute la licence, le créateur puis les quatre extensions d’historique, dans cet ordre', () => {
    const c = cfg({ licenseExtension: EXT_LIC, creatorExtension: EXT_CREATOR, history: HISTORY });
    expect(extensionsALire(c, EXT_ACT)).toEqual([EXT, EXT_ACT, EXT_LIC, EXT_CREATOR, HISTORY.validation, HISTORY.activation, HISTORY.regeneration, HISTORY.termine]);
  });
});

describe('statutDe', () => {
  it.each([
    ['EnAttente', 'EnAttente'],
    ['Validé', 'Validé'],
    ['Actif', 'Actif'],
    ['Terminé', 'Terminé'],
    ['Valide', null],
    ['actif', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%j donne %j', (brut, attendu) => {
    expect(statutDe(brut)).toBe(attendu);
  });
});

describe('lectureDouce', () => {
  it('rend la valeur lue et ne trace rien', async () => {
    const a = audit();
    expect(await lectureDouce(a, RH_ID, DIR_ID)('detail_x', 'repli', async () => 'lu')).toBe('lu');
    expect(a.track).not.toHaveBeenCalled();
  });

  it('un échec rend le repli et trace demande.echec avec l’étape et la cible, jamais le message de l’erreur', async () => {
    const a = audit();
    expect(await lectureDouce(a, RH_ID, DIR_ID)('detail_x', null, async () => Promise.reject(new Error('Anna Martin')))).toBeNull();
    expect(a.track).toHaveBeenCalledTimes(1);
    const evt = a.track.mock.calls[0]![0];
    expect(evt).toMatchObject({ action: 'demande.echec', actor: RH_ID, outcome: 'erreur', etape: 'detail_x', cible: DIR_ID });
    expect(JSON.stringify(evt)).not.toContain('Anna');
  });
});

describe('lireUtilisateur', () => {
  const compte = (statut: string | null) => ({ id: DIR_ID, extensions: { [EXT]: statut } }) as unknown as DemandeLue;
  const deps = (getDemande: () => Promise<DemandeLue | null>) => {
    const a = audit();
    return { a, deps: { config: cfg(), directory: directory({ getDemande }), audit: a } as unknown as ActivationDeps };
  };

  it('rend le compte et son statut, et demande les extensions fournies', async () => {
    const getDemande = vi.fn(async () => compte('Validé'));
    const { deps: d } = deps(getDemande);
    expect(await lireUtilisateur(d, RH_ID, DIR_ID, [EXT, EXT_ACT])).toEqual({ u: compte('Validé'), statut: 'Validé' });
    expect(getDemande).toHaveBeenCalledWith(DIR_ID, [EXT, EXT_ACT]);
  });

  it('502 tracé quand Graph échoue', async () => {
    const { a, deps: d } = deps(async () => Promise.reject(new Error('boom')));
    const err = await lireUtilisateur(d, RH_ID, DIR_ID, [EXT]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err).toMatchObject({ status: 502, body: { etape: 'detail_lecture' } });
    expect(a.track).toHaveBeenCalledWith(expect.objectContaining({ action: 'demande.echec', etape: 'detail_lecture', cible: DIR_ID }));
  });

  it.each([
    ['compte absent', null],
    ['compte sans statut', compte(null)],
    ['statut inconnu', compte('Archivé')],
  ])('404 tracé (refus) : %s', async (_nom, lu) => {
    const { a, deps: d } = deps(async () => lu);
    await expect(lireUtilisateur(d, RH_ID, DIR_ID, [EXT])).rejects.toMatchObject({ status: 404, body: { error: 'Demande introuvable' } });
    expect(a.track).toHaveBeenCalledWith({ action: 'demande.introuvable', actor: RH_ID, outcome: 'refuse', cible: DIR_ID });
  });
});

describe('evenementsDe', () => {
  it('décode les événements présents, la régénération garde son nombre', () => {
    const extensions = {
      [HISTORY.validation]: `${DIR_ID}|${quand}`,
      [HISTORY.regeneration]: `${RH_ID}|${quand}|3`,
    };
    expect(evenementsDe(HISTORY, extensions)).toEqual({
      validation: { par: DIR_ID, le: quand },
      activation: null,
      regeneration: { par: RH_ID, le: quand, nombre: 3 },
      termine: null,
    });
  });

  it('historique non configuré ou valeur illisible : tout est null', () => {
    expect(evenementsDe(undefined, { [HISTORY.validation]: `${DIR_ID}|${quand}` })).toEqual(sansEvenements);
    expect(evenementsDe(HISTORY, { [HISTORY.validation]: 'pas-un-evenement' })).toEqual(sansEvenements);
  });
});

describe('createurDe', () => {
  it('rend l’objectId lu dans l’extension', () => {
    expect(createurDe(EXT_CREATOR, { [EXT_CREATOR]: RH_ID })).toBe(RH_ID);
  });

  it.each([
    ['extension non configurée', undefined, { [EXT_CREATOR]: RH_ID }],
    ['valeur absente', EXT_CREATOR, {}],
    ['valeur null', EXT_CREATOR, { [EXT_CREATOR]: null }],
    ['valeur falsifiée : jamais utilisée dans un chemin Graph', EXT_CREATOR, { [EXT_CREATOR]: '../../me' }],
  ])('null : %s', (_nom, ext, extensions) => {
    expect(createurDe(ext, extensions)).toBeNull();
  });
});

describe('auteursDistincts', () => {
  it('minuscules, sans doublon, sans valeur vide ni tâche du serveur', () => {
    expect(auteursDistincts([RH_ID.toUpperCase(), RH_ID, null, undefined, '', ACTEUR_SYSTEME, DIR_ID])).toEqual([RH_ID, DIR_ID]);
  });

  it('liste vide quand personne n’est connu', () => {
    expect(auteursDistincts([null, undefined, ACTEUR_SYSTEME])).toEqual([]);
  });
});

describe('lireNoms', () => {
  it('un appel par objectId ; un échec donne null pour cet auteur seulement', async () => {
    const getDisplayName = vi.fn(async (id: string) => (id === RH_ID ? 'Nom RH' : Promise.reject(new Error('404'))));
    const a = audit();
    const resultat = await lireNoms(lectureDouce(a, RH_ID, DIR_ID), directory({ getDisplayName }), [RH_ID, DIR_ID]);
    expect(Object.fromEntries(resultat)).toEqual({ [RH_ID]: 'Nom RH', [DIR_ID]: null });
    expect(getDisplayName).toHaveBeenCalledTimes(2);
    expect(a.track).toHaveBeenCalledWith(expect.objectContaining({ etape: 'detail_acteur' }));
  });

  it('aucun appel sans objectId', async () => {
    const getDisplayName = vi.fn();
    expect((await lireNoms(lectureDouce(audit(), RH_ID, DIR_ID), directory({ getDisplayName }), [])).size).toBe(0);
    expect(getDisplayName).not.toHaveBeenCalled();
  });
});

describe('acteurDe et faitDe', () => {
  const n = noms([[RH_ID, 'Nom RH'], [DIR_ID, null]]);

  it('acteurDe : inconnu, tâche du serveur, nom résolu (casse ignorée), nom introuvable', () => {
    expect(acteurDe(null, n)).toBeNull();
    expect(acteurDe(ACTEUR_SYSTEME, n)).toEqual({ nom: null, systeme: true });
    expect(acteurDe(RH_ID.toUpperCase(), n)).toEqual({ nom: 'Nom RH' });
    expect(acteurDe(DIR_ID, n)).toEqual({ nom: null });
    expect(acteurDe('cccccccc-0000-4000-8000-000000000003', n)).toEqual({ nom: null });
  });

  it('faitDe : null sans événement, sinon la date et l’auteur', () => {
    expect(faitDe(null, n)).toBeNull();
    expect(faitDe({ par: RH_ID, le: quand }, n)).toEqual({ le: quand, par: { nom: 'Nom RH' } });
    expect(faitDe({ par: ACTEUR_SYSTEME, le: quand }, n)).toEqual({ le: quand, par: { nom: null, systeme: true } });
  });
});

describe('skuDe et libelleLicence', () => {
  it('skuDe : en minuscules ; null si non configurée ou absente', () => {
    expect(skuDe(EXT_LIC, { [EXT_LIC]: 'ABC-DEF' })).toBe('abc-def');
    expect(skuDe(undefined, { [EXT_LIC]: 'abc' })).toBeNull();
    expect(skuDe(EXT_LIC, {})).toBeNull();
    expect(skuDe(EXT_LIC, { [EXT_LIC]: null })).toBeNull();
  });

  it('libelleLicence : le libellé du SKU, null s’il a été retiré de LICENSES ou si le SKU est null', () => {
    const licenses = [{ skuId: 'abc', libelle: 'Licence A', groupId: RH_ID }];
    expect(libelleLicence(licenses, 'abc')).toBe('Licence A');
    expect(libelleLicence(licenses, 'autre')).toBeNull();
    expect(libelleLicence(licenses, null)).toBeNull();
  });
});

describe('nomDossierDe', () => {
  it('forme le nom d’après le motif', () => {
    expect(nomDossierDe('{nom} {prenom}', { surname: 'Martin', givenName: 'Anna' }, DIR_ID)).toBe('Martin Anna');
    expect(nomDossierDe('{nom}-{id}', { surname: 'Martin', givenName: null }, DIR_ID)).toBe(`Martin-${DIR_ID}`);
  });

  it('null quand le nom est vide après nettoyage', () => {
    expect(nomDossierDe('{nom} {prenom}', { surname: null, givenName: null }, DIR_ID)).toBeNull();
  });
});

describe('lireAuthenticator', () => {
  it('compte ni Actif ni Terminé : liste vide, sans appel Graph', async () => {
    const listAuthenticatorMethods = vi.fn();
    expect(await lireAuthenticator(lectureDouce(audit(), RH_ID, DIR_ID), directory({ listAuthenticatorMethods }), DIR_ID, false)).toEqual([]);
    expect(listAuthenticatorMethods).not.toHaveBeenCalled();
  });

  it('Actif ou Terminé : lit les méthodes ; un échec donne null, tracé', async () => {
    const methodes = [{ createdDateTime: quand }];
    const doux = lectureDouce(audit(), RH_ID, DIR_ID);
    expect(await lireAuthenticator(doux, directory({ listAuthenticatorMethods: async () => methodes }), DIR_ID, true)).toEqual(methodes);
    const a = audit();
    expect(await lireAuthenticator(lectureDouce(a, RH_ID, DIR_ID), directory({ listAuthenticatorMethods: async () => Promise.reject(new Error('x')) }), DIR_ID, true)).toBeNull();
    expect(a.track).toHaveBeenCalledWith(expect.objectContaining({ etape: 'detail_authenticator' }));
  });
});

describe('lireGroupe', () => {
  const GROUPE = 'dddddddd-0000-4000-8000-000000000004';

  it.each([
    ['Terminé : retiré du groupe, sans lecture', 'Terminé', GROUPE, true, false],
    ['Terminé sans groupe configuré : toujours false', 'Terminé', undefined, true, false],
    ['EnAttente : sans objet', 'EnAttente', GROUPE, false, null],
    ['groupe non configuré : sans objet', 'Validé', undefined, true, null],
  ] as const)('%s', async (_nom, statut, groupId, apresValidation, attendu) => {
    const isMemberOfGroup = vi.fn();
    expect(await lireGroupe(lectureDouce(audit(), RH_ID, DIR_ID), directory({ isMemberOfGroup }), DIR_ID, statut, groupId, apresValidation)).toBe(attendu);
    expect(isMemberOfGroup).not.toHaveBeenCalled();
  });

  it('Validé ou Actif : lit l’appartenance ; un échec donne null, tracé', async () => {
    const isMemberOfGroup = vi.fn(async () => true);
    expect(await lireGroupe(lectureDouce(audit(), RH_ID, DIR_ID), directory({ isMemberOfGroup }), DIR_ID, 'Actif', GROUPE, true)).toBe(true);
    expect(isMemberOfGroup).toHaveBeenCalledWith(DIR_ID, GROUPE);
    const a = audit();
    expect(await lireGroupe(lectureDouce(a, RH_ID, DIR_ID), directory({ isMemberOfGroup: async () => Promise.reject(new Error('x')) }), DIR_ID, 'Validé', GROUPE, true)).toBeNull();
    expect(a.track).toHaveBeenCalledWith(expect.objectContaining({ etape: 'detail_groupe' }));
  });
});

describe('lireLicence', () => {
  const lecture: LicenseRead = { entry: { state: 'Active', error: null, assignedByGroup: null }, total: 1 };

  it('undefined (sans objet) avant la validation ou sans SKU, sans lecture', async () => {
    const readLicenseStates = vi.fn();
    const doux = lectureDouce(audit(), RH_ID, DIR_ID);
    expect(await lireLicence(doux, directory({ readLicenseStates }), DIR_ID, 'sku', false)).toBeUndefined();
    expect(await lireLicence(doux, directory({ readLicenseStates }), DIR_ID, null, true)).toBeUndefined();
    expect(readLicenseStates).not.toHaveBeenCalled();
  });

  it('lit l’état du SKU ; un échec donne null, tracé', async () => {
    const readLicenseStates = vi.fn(async () => lecture);
    expect(await lireLicence(lectureDouce(audit(), RH_ID, DIR_ID), directory({ readLicenseStates }), DIR_ID, 'sku', true)).toBe(lecture);
    expect(readLicenseStates).toHaveBeenCalledWith(DIR_ID, 'sku');
    const a = audit();
    expect(await lireLicence(lectureDouce(a, RH_ID, DIR_ID), directory({ readLicenseStates: async () => Promise.reject(new Error('x')) }), DIR_ID, 'sku', true)).toBeNull();
    expect(a.track).toHaveBeenCalledWith(expect.objectContaining({ etape: 'detail_licence' }));
  });
});

describe('lireDossier', () => {
  const bibliotheque = (findFolder: () => Promise<{ webUrl: string | null } | null>) => ({ findFolder }) as unknown as Parameters<typeof lireDossier>[1];

  it('undefined (sans objet) avant la validation, sans bibliothèque ou sans nom, sans lecture', async () => {
    const findFolder = vi.fn();
    const doux = lectureDouce(audit(), RH_ID, DIR_ID);
    expect(await lireDossier(doux, bibliotheque(findFolder), false, 'Martin')).toBeUndefined();
    expect(await lireDossier(doux, undefined, true, 'Martin')).toBeUndefined();
    expect(await lireDossier(doux, bibliotheque(findFolder), true, null)).toBeUndefined();
    expect(findFolder).not.toHaveBeenCalled();
  });

  it('dossier trouvé, absent (null) ou lecture en échec (undefined, tracé)', async () => {
    const doux = lectureDouce(audit(), RH_ID, DIR_ID);
    expect(await lireDossier(doux, bibliotheque(async () => ({ webUrl: 'https://exemple.test/d' })), true, 'Martin')).toEqual({ webUrl: 'https://exemple.test/d' });
    expect(await lireDossier(doux, bibliotheque(async () => null), true, 'Martin')).toBeNull();
    const a = audit();
    expect(await lireDossier(lectureDouce(a, RH_ID, DIR_ID), bibliotheque(async () => Promise.reject(new Error('x'))), true, 'Martin')).toBeUndefined();
    expect(a.track).toHaveBeenCalledWith(expect.objectContaining({ etape: 'detail_dossier' }));
  });
});

describe('authenticatorPresent et datesAuthenticator', () => {
  it('authenticatorPresent : null si la lecture a échoué, sinon au moins une méthode', () => {
    expect(authenticatorPresent(null)).toBeNull();
    expect(authenticatorPresent([])).toBe(false);
    expect(authenticatorPresent([{ createdDateTime: null }])).toBe(true);
  });

  it('datesAuthenticator : trie, écarte les dates absentes ou invalides', () => {
    const methodes = [
      { createdDateTime: '2026-10-27T10:00:00Z' },
      { createdDateTime: null },
      { createdDateTime: 'pas-une-date' },
      { createdDateTime: '2026-10-26T08:00:00Z' },
    ];
    expect(datesAuthenticator(methodes)).toEqual(['2026-10-26T08:00:00Z', '2026-10-27T10:00:00Z']);
    expect(datesAuthenticator(null)).toEqual([]);
    expect(datesAuthenticator([])).toEqual([]);
  });
});

describe('onboardingDe', () => {
  it.each(['EnAttente', 'Validé', 'Terminé'] as const)('%s : pas d’état d’onboarding', (statut) => {
    expect(onboardingDe(statut, true, true)).toBeUndefined();
  });

  it('Actif : lecture impossible, ou les deux critères', () => {
    expect(onboardingDe('Actif', null, true)).toEqual({ verification: 'echec' });
    expect(onboardingDe('Actif', true, true)).toEqual({ motDePasse: true, authenticator: true, termine: true });
    expect(onboardingDe('Actif', true, false)).toEqual({ motDePasse: false, authenticator: true, termine: false });
    expect(onboardingDe('Actif', false, true)).toEqual({ motDePasse: true, authenticator: false, termine: false });
  });
});

describe('licenceDetail', () => {
  const entree = (state: string, error: string | null): LicenseRead => ({ entry: { state, error, assignedByGroup: null }, total: 1 });

  it.each([
    ['pas de SKU : null', null, false, undefined, null],
    ['avant la validation : choisie', 'sku', false, undefined, { libelle: 'Licence A', etat: 'choisie' }],
    ['lecture en échec : inconnu', 'sku', true, null, { libelle: 'Licence A', etat: 'inconnu' }],
    ['sans objet : inconnu', 'sku', true, undefined, { libelle: 'Licence A', etat: 'inconnu' }],
    ['pas encore traitée par Entra : en_cours', 'sku', true, { entry: null, total: 0 }, { libelle: 'Licence A', etat: 'en_cours' }],
    ['Active sans erreur : attribuee', 'sku', true, entree('Active', null), { libelle: 'Licence A', etat: 'attribuee' }],
    ['Active avec une erreur : erreur', 'sku', true, entree('Active', 'CountViolation'), { libelle: 'Licence A', etat: 'erreur' }],
    ['ActiveWithError : erreur', 'sku', true, entree('ActiveWithError', null), { libelle: 'Licence A', etat: 'erreur' }],
  ] as const)('%s', (_nom, sku, apresValidation, etat, attendu) => {
    expect(licenceDetail(sku, 'Licence A', apresValidation, etat as LicenseRead | null | undefined)).toEqual(attendu);
  });

  it('un SKU retiré de LICENSES garde un libellé null', () => {
    expect(licenceDetail('sku', null, false, undefined)).toEqual({ libelle: null, etat: 'choisie' });
  });
});

describe('groupeArrivantsDe et dossierEtatDe', () => {
  it('groupeArrivantsDe : null sans objet ou lecture impossible, sinon l’appartenance', () => {
    expect(groupeArrivantsDe(null)).toBeNull();
    expect(groupeArrivantsDe(undefined)).toBeNull();
    expect(groupeArrivantsDe(true)).toEqual({ membre: true });
    expect(groupeArrivantsDe(false)).toEqual({ membre: false });
  });

  it('dossierEtatDe : null sans objet, absent, ou présent avec son adresse', () => {
    expect(dossierEtatDe(undefined)).toBeNull();
    expect(dossierEtatDe(null)).toEqual({ etat: 'absent' });
    expect(dossierEtatDe({ webUrl: 'https://exemple.test/d' })).toEqual({ etat: 'present', url: 'https://exemple.test/d' });
    expect(dossierEtatDe({ webUrl: null })).toEqual({ etat: 'present', url: null });
  });
});

describe('historiqueDe', () => {
  const base = {
    enregistre: true,
    createdDateTime: '2026-10-01T08:00:00Z',
    lastPasswordChange: '2026-10-28T09:00:00Z',
    createur: RH_ID,
    evenements: sansEvenements,
    noms: noms([[RH_ID, 'Nom RH'], [DIR_ID, 'Nom Direction']]),
    authenticator: null,
    dates: [],
    motDePasse: false,
  };

  it('sans événement : seule la création est connue', () => {
    expect(historiqueDe(base)).toEqual({
      enregistre: true,
      creation: { le: '2026-10-01T08:00:00Z', par: { nom: 'Nom RH' } },
      validation: null,
      activation: null,
      regeneration: null,
      authenticator: null,
      motDePasse: null,
      termine: null,
    });
  });

  it('créateur inconnu et historique non enregistré', () => {
    expect(historiqueDe({ ...base, enregistre: false, createur: null, createdDateTime: null }).creation).toEqual({ le: null, par: null });
    expect(historiqueDe({ ...base, enregistre: false }).enregistre).toBe(false);
  });

  it('étapes faites : auteurs, nombre de remises (1 par défaut), Authenticator, mot de passe', () => {
    const evenements: Evenements = {
      validation: { par: DIR_ID, le: quand },
      activation: { par: RH_ID, le: quand },
      regeneration: { par: RH_ID, le: quand, nombre: 2 },
      termine: { par: ACTEUR_SYSTEME, le: quand },
    };
    const h = historiqueDe({ ...base, evenements, authenticator: true, dates: ['2026-10-26T08:00:00Z', '2026-10-27T10:00:00Z'], motDePasse: true });
    expect(h.validation).toEqual({ le: quand, par: { nom: 'Nom Direction' } });
    expect(h.activation).toEqual({ le: quand, par: { nom: 'Nom RH' } });
    expect(h.regeneration).toEqual({ le: quand, par: { nom: 'Nom RH' }, nombre: 2 });
    expect(h.termine).toEqual({ le: quand, par: { nom: null, systeme: true } });
    expect(h.authenticator).toEqual({ le: '2026-10-26T08:00:00Z' });
    expect(h.motDePasse).toEqual({ le: '2026-10-28T09:00:00Z' });
    expect(historiqueDe({ ...base, evenements: { ...sansEvenements, regeneration: { par: RH_ID, le: quand } } }).regeneration?.nombre).toBe(1);
  });

  it('Authenticator inscrit sans date fournie ; mot de passe changé sans date lue', () => {
    expect(historiqueDe({ ...base, authenticator: true, dates: [] }).authenticator).toEqual({ le: null });
    expect(historiqueDe({ ...base, motDePasse: true, lastPasswordChange: null }).motDePasse).toBeNull();
  });

  it('round-trip : un événement encodé par history.ts se décode puis se présente', () => {
    const evenements = evenementsDe(HISTORY, { [HISTORY.validation]: encoderEvenement(DIR_ID, new Date(quand)) });
    expect(historiqueDe({ ...base, evenements }).validation).toEqual({ le: quand, par: { nom: 'Nom Direction' } });
  });
});
