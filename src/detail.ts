import type { Droits } from './auth';
import { motDePasseChange, activationConfig, type ActivationDeps, type OnboardingState } from './activation';
import { todayIn } from './dates';
import { ServiceError } from './demandes';
import type { DirectionDeps } from './direction';
import { graphFailureProps, type DemandeLue, type LicenseRead } from './directory';
import { buildFolderName } from './folder';
import { ACTEUR_SYSTEME, decoderEvenement, type Evenement } from './history';
import { STATUTS, actionsFor, type Statut, type SuiviAction } from './suivi';
import type { TypeContrat } from './typeContrat';
import { GUID_RE } from './validation';

/** Auteur d'une étape : son nom affiché, `null` si le compte n'existe plus ou n'a pas pu être lu ; `systeme` : la tâche du serveur. */
export interface Acteur {
  nom: string | null;
  systeme?: true;
}

export interface EtapeFaite {
  /** Date ISO UTC (l'interface l'affiche en heure de Paris). */
  le: string;
  par: Acteur;
}

/**
 * Chronologie d'une demande. `null` : l'étape n'a pas eu lieu, ou a eu lieu avant que l'historique soit enregistré (l'interface
 * le déduit du statut : « non enregistrée »). Les dates du mot de passe et d'Authenticator viennent d'Entra, pas de l'historique.
 */
export interface Historique {
  /** false : les extensions d'historique ne sont pas configurées (rien n'est enregistré, seule la création est connue). */
  enregistre: boolean;
  /** Création du compte : `createdDateTime` d'Entra, et le créateur (extension `createurOnboarding`, absente des demandes anciennes). */
  creation: { le: string | null; par: Acteur | null };
  validation: EtapeFaite | null;
  activation: EtapeFaite | null;
  /** Dernière régénération du mot de passe temporaire, et nombre de remises depuis l'activation. */
  regeneration: (EtapeFaite & { nombre: number }) | null;
  /** Authenticator inscrit ; `le` null : Entra ne fournit pas la date (connexion sans mot de passe non activée). */
  authenticator: { le: string | null } | null;
  /** Mot de passe changé par l'arrivant après la dernière remise (`lastPasswordChangeDateTime`). */
  motDePasse: { le: string } | null;
  termine: EtapeFaite | null;
}

export interface DemandeDetail {
  id: string;
  nom: string;
  upn: string | null;
  poste: string | null;
  service: string | null;
  /** Type de contrat (employeeType) ; null : compte antérieur au formulaire par type, ou valeur inconnue. */
  typeContrat: TypeContrat | null;
  manager: { nom: string } | null;
  /** AAAA-MM-JJ */
  dateArrivee: string | null;
  statut: Statut;
  etape: 1 | 2 | 3 | 4;
  /** choisie : réservée à la validation ; attribuee / en_cours / erreur : état Entra ; inconnu : lecture impossible. `libelle` null : SKU retiré de LICENSES. */
  licence: { libelle: string | null; etat: 'choisie' | 'attribuee' | 'en_cours' | 'erreur' | 'inconnu' } | null;
  /** Appartenance au groupe des arrivants (Validé et Actif) ; null : sans objet (EnAttente) ou lecture impossible. */
  groupeArrivants: { membre: boolean } | null;
  /** Dossier SharePoint ; null : sans objet (EnAttente), SharePoint non configuré ou lecture impossible. */
  dossier: { etat: 'present'; url: string | null } | { etat: 'absent' } | null;
  /** Comptes Actif ; { verification: 'echec' } si la lecture d'Authenticator a échoué. */
  onboarding?: OnboardingState | { verification: 'echec' };
  /** Mêmes règles que GET /api/suivi (actionsFor) : l'interface ne propose que ces actions. */
  actions: SuiviAction[];
  historique: Historique;
}

type DetailDeps = ActivationDeps & Pick<DirectionDeps, 'library'>;

/**
 * Lit une demande pour sa page de détail : un `GET /users/{id}` (manager inclus), puis, selon le statut, le nom des auteurs, les
 * méthodes Authenticator, le groupe des arrivants, la licence et le dossier SharePoint. Aucune permission Graph de plus (User.Read.All,
 * UserAuthMethod-MicrosoftAuthApp.Read.All, GroupMember.ReadWrite.All, LicenseAssignment.Read.All, Sites.Selected, déjà accordées).
 *
 * **Garde-fou** : un compte sans statut d'onboarding (ou à un statut inconnu) répond 404 comme s'il n'existait pas. Sans cela, toute
 * personne ayant accès lirait le profil de n'importe quel compte du tenant par son objectId.
 *
 * Une lecture annexe qui échoue (tracée `demande.echec`) ne fait pas échouer la page : la rubrique est `null` / `inconnu`.
 * Un refus supprime le compte : une demande refusée n'a pas de page.
 */
type Cfg = DetailDeps['config'];
type Directory = ActivationDeps['directory'];
type Library = NonNullable<DetailDeps['library']>;
type Extensions = Record<string, string | null>;
type Methodes = { createdDateTime: string | null }[];
type DossierLu = { webUrl: string | null } | null | undefined;

/** Nom affiché des auteurs, par objectId en minuscules ; `null` : compte introuvable ou lecture en échec. */
export type Noms = ReadonlyMap<string, string | null>;

/** Lecture annexe : un échec est tracé et rend `repli`, la page reste affichée. */
export type LectureDouce = <T>(etape: string, repli: T, fn: () => Promise<T>) => Promise<T>;

export interface Evenements {
  validation: Evenement | null;
  activation: Evenement | null;
  regeneration: Evenement | null;
  termine: Evenement | null;
}

export interface EntreeHistorique {
  enregistre: boolean;
  createdDateTime: string | null;
  lastPasswordChange: string | null;
  createur: string | null;
  evenements: Evenements;
  noms: Noms;
  authenticator: boolean | null;
  dates: string[];
  motDePasse: boolean;
}

/** Extensions à demander avec `GET /users/{id}` : statut, activation, puis celles qui sont configurées (licence, créateur, historique). */
export function extensionsALire(config: Cfg, activationExt: string): string[] {
  const h = config.history;
  return [config.statusExtension, activationExt, ...(config.licenseExtension ? [config.licenseExtension] : []), ...(config.creatorExtension ? [config.creatorExtension] : []), ...(h ? [h.validation, h.activation, h.regeneration, h.termine] : [])];
}

/** `null` : valeur absente ou qui n'est pas un statut d'onboarding. */
export function statutDe(brut: string | null | undefined): Statut | null {
  return (STATUTS as readonly string[]).includes(brut ?? '') ? (brut as Statut) : null;
}

export function lectureDouce(audit: ActivationDeps['audit'], actor: string, id: string): LectureDouce {
  return async <T>(etape: string, repli: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape, cible: id, ...graphFailureProps(err) });
      return repli;
    }
  };
}

/** Lit le compte et son statut. 502 si Graph échoue ; 404 si ce n'est pas une demande d'onboarding (garde-fou). */
export async function lireUtilisateur(deps: ActivationDeps, actor: string, id: string, exts: readonly string[]): Promise<{ u: DemandeLue; statut: Statut }> {
  const { config, directory, audit } = deps;
  let u: DemandeLue | null;
  try {
    u = await directory.getDemande(id, exts);
  } catch (err) {
    audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape: 'detail_lecture', cible: id, ...graphFailureProps(err) });
    throw new ServiceError(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'detail_lecture' });
  }
  const statut = statutDe(u?.extensions[config.statusExtension]);
  if (!u || statut === null) {
    audit.track({ action: 'demande.introuvable', actor, outcome: 'refuse', cible: id });
    throw new ServiceError(404, { error: 'Demande introuvable' });
  }
  return { u, statut };
}

/** Les quatre événements d'historique, décodés ; tous `null` quand l'historique n'est pas configuré ou qu'une valeur est illisible. */
export function evenementsDe(h: Cfg['history'], extensions: Extensions): Evenements {
  const lire = (ext: string | undefined) => decoderEvenement(ext ? extensions[ext] : null);
  return { validation: lire(h?.validation), activation: lire(h?.activation), regeneration: lire(h?.regeneration), termine: lire(h?.termine) };
}

/** L'extension est écrivable par un administrateur d'utilisateurs : seul un objectId sert de chemin Graph (comme les auteurs de l'historique, validés par decoderEvenement). */
export function createurDe(creatorExtension: string | undefined, extensions: Extensions): string | null {
  const brut = creatorExtension ? (extensions[creatorExtension] ?? null) : null;
  return brut !== null && GUID_RE.test(brut) ? brut : null;
}

/** objectIds à résoudre en noms : sans doublon (casse comprise), sans la tâche du serveur (trois au plus en pratique). */
export function auteursDistincts(pars: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(pars.filter((x): x is string => !!x && x !== ACTEUR_SYSTEME).map((x) => x.toLowerCase()))];
}

/** Un appel par objectId distinct, jamais tracé avec le nom. */
export async function lireNoms(doux: LectureDouce, directory: Directory, ids: string[]): Promise<Noms> {
  return new Map(await Promise.all(ids.map(async (a) => [a, await doux<string | null>('detail_acteur', null, () => directory.getDisplayName(a))] as const)));
}

export function acteurDe(par: string | null, noms: Noms): Acteur | null {
  if (par === null) return null;
  return par === ACTEUR_SYSTEME ? { nom: null, systeme: true } : { nom: noms.get(par.toLowerCase()) ?? null };
}

export function faitDe(e: Evenement | null, noms: Noms): EtapeFaite | null {
  return e ? { le: e.le, par: acteurDe(e.par, noms) as Acteur } : null;
}

/** skuId de la licence réservée (en minuscules) ; `null` : licence non configurée ou absente du compte. */
export function skuDe(licenseExtension: string | undefined, extensions: Extensions): string | null {
  return licenseExtension ? (extensions[licenseExtension]?.toLowerCase() ?? null) : null;
}

/** `null` : SKU absent de LICENSES (retiré depuis la demande). */
export function libelleLicence(licenses: Cfg['licenses'], sku: string | null): string | null {
  return licenses.find((l) => l.skuId === sku)?.libelle ?? null;
}

/** `null` : nom impossible à former (prénom et nom absents, motif refusé). */
export function nomDossierDe(folderPattern: string, u: Pick<DemandeLue, 'surname' | 'givenName'>, id: string): string | null {
  try {
    return buildFolderName(folderPattern, { nom: u.surname ?? '', prenom: u.givenName ?? '', id });
  } catch {
    return null;
  }
}

/** Authenticator : lu seulement pour un compte Actif ou Terminé (sinon `[]`) ; `null` : lecture en échec. */
export function lireAuthenticator(doux: LectureDouce, directory: Directory, id: string, actifOuTermine: boolean): Promise<Methodes | null> {
  return actifOuTermine ? doux<Methodes | null>('detail_authenticator', null, () => directory.listAuthenticatorMethods(id)) : Promise.resolve([]);
}

/** Groupe des arrivants : `false` une fois Terminé (retiré), `null` : sans objet ou lecture en échec. */
export function lireGroupe(doux: LectureDouce, directory: Directory, id: string, statut: Statut, groupId: string | undefined, apresValidation: boolean): Promise<boolean | null> {
  if (statut === 'Terminé') return Promise.resolve(false);
  return apresValidation && groupId ? doux<boolean | null>('detail_groupe', null, () => directory.isMemberOfGroup(id, groupId)) : Promise.resolve(null);
}

/** État de la licence dans Entra : `undefined` : sans objet ; `null` : lecture en échec. */
export function lireLicence(doux: LectureDouce, directory: Directory, id: string, sku: string | null, apresValidation: boolean): Promise<LicenseRead | null | undefined> {
  return apresValidation && sku ? doux<LicenseRead | null>('detail_licence', null, () => directory.readLicenseStates(id, sku)) : Promise.resolve(undefined);
}

/** Dossier SharePoint : `undefined` : sans objet, non configuré, nom impossible à former ou lecture en échec ; `null` : lu et absent. */
export function lireDossier(doux: LectureDouce, library: Library | undefined, apresValidation: boolean, dossierNom: string | null): Promise<DossierLu> {
  return apresValidation && library && dossierNom ? doux<DossierLu>('detail_dossier', undefined, () => library.findFolder(dossierNom)) : Promise.resolve(undefined);
}

/** `null` : lecture impossible ; sinon au moins une méthode Authenticator inscrite. */
export function authenticatorPresent(methodes: Methodes | null): boolean | null {
  return methodes === null ? null : methodes.length > 0;
}

/** Dates d'inscription valides, de la plus ancienne à la plus récente (comparaison de chaînes ISO, comme le tri d'origine). */
export function datesAuthenticator(methodes: Methodes | null): string[] {
  return (methodes ?? []).map((m) => m.createdDateTime).filter((d): d is string => d !== null && Number.isFinite(Date.parse(d))).sort();
}

/** Comptes Actif seulement ; `{ verification: 'echec' }` quand la lecture d'Authenticator a échoué. */
export function onboardingDe(statut: Statut, authenticator: boolean | null, motDePasse: boolean): DemandeDetail['onboarding'] {
  if (statut !== 'Actif') return undefined;
  return authenticator === null ? { verification: 'echec' } : { motDePasse, authenticator, termine: motDePasse && authenticator };
}

export function licenceDetail(sku: string | null, libelle: string | null, apresValidation: boolean, etatLicence: LicenseRead | null | undefined): DemandeDetail['licence'] {
  if (!sku) return null;
  if (!apresValidation) return { libelle, etat: 'choisie' };
  if (etatLicence === null || etatLicence === undefined) return { libelle, etat: 'inconnu' };
  if (etatLicence.entry === null) return { libelle, etat: 'en_cours' };
  return { libelle, etat: etatLicence.entry.state === 'Active' && !etatLicence.entry.error ? 'attribuee' : 'erreur' };
}

/** `null` : sans objet ou lecture impossible. */
export function groupeArrivantsDe(groupe: boolean | null | undefined): DemandeDetail['groupeArrivants'] {
  return groupe === null || groupe === undefined ? null : { membre: groupe };
}

/** undefined : sans objet, non configuré, nom impossible à former ou lecture en échec ; null : lue et absente. */
export function dossierEtatDe(dossier: DossierLu): DemandeDetail['dossier'] {
  if (dossier === undefined) return null;
  return dossier === null ? { etat: 'absent' } : { etat: 'present', url: dossier.webUrl };
}

export function historiqueDe(e: EntreeHistorique): Historique {
  const { evenements: ev, noms } = e;
  return {
    enregistre: e.enregistre,
    creation: { le: e.createdDateTime, par: acteurDe(e.createur, noms) },
    validation: faitDe(ev.validation, noms),
    activation: faitDe(ev.activation, noms),
    regeneration: ev.regeneration ? { ...(faitDe(ev.regeneration, noms) as EtapeFaite), nombre: ev.regeneration.nombre ?? 1 } : null,
    authenticator: e.authenticator ? { le: e.dates[0] ?? null } : null,
    motDePasse: e.motDePasse && e.lastPasswordChange ? { le: e.lastPasswordChange } : null,
    termine: faitDe(ev.termine, noms),
  };
}

export async function lireDemande(deps: DetailDeps, actor: string, id: string, now: Date, droits: Droits): Promise<DemandeDetail> {
  const { config, directory, audit, library } = deps;
  const { activationExt } = activationConfig(deps);
  const { u, statut } = await lireUtilisateur(deps, actor, id, extensionsALire(config, activationExt));
  const doux = lectureDouce(audit, actor, id);

  const evenements = evenementsDe(config.history, u.extensions);
  const createur = createurDe(config.creatorExtension, u.extensions);
  const noms = await lireNoms(doux, directory, auteursDistincts([createur, evenements.validation?.par, evenements.activation?.par, evenements.regeneration?.par, evenements.termine?.par]));

  const apresValidation = statut !== 'EnAttente';
  const actifOuTermine = statut === 'Actif' || statut === 'Terminé';
  const sku = skuDe(config.licenseExtension, u.extensions);
  const [methodes, groupe, etatLicence, dossier] = await Promise.all([
    lireAuthenticator(doux, directory, id, actifOuTermine),
    lireGroupe(doux, directory, id, statut, config.arrivantsGroupId, apresValidation),
    lireLicence(doux, directory, id, sku, apresValidation),
    lireDossier(doux, library, apresValidation, nomDossierDe(config.sharePoint.folderPattern, u, id)),
  ]);

  const authenticator = authenticatorPresent(methodes);
  const progress = { lastPasswordChange: u.lastPasswordChange, activation: u.extensions[activationExt] ?? null, createdDateTime: u.createdDateTime };
  const motDePasse = actifOuTermine && motDePasseChange(progress);
  const onboarding = onboardingDe(statut, authenticator, motDePasse);
  const dossierEtat = dossierEtatDe(dossier);
  const detail: DemandeDetail = {
    id: u.id,
    nom: u.displayName,
    upn: u.upn,
    poste: u.poste,
    service: u.service,
    typeContrat: u.typeContrat,
    manager: u.managerNom ? { nom: u.managerNom } : null,
    dateArrivee: u.dateArrivee,
    statut,
    etape: (STATUTS.indexOf(statut) + 1) as DemandeDetail['etape'],
    licence: licenceDetail(sku, libelleLicence(config.licenses, sku), apresValidation, etatLicence),
    groupeArrivants: groupeArrivantsDe(groupe),
    dossier: dossierEtat,
    ...(onboarding ? { onboarding } : {}),
    // Dossier prouvé absent (lecture réussie) : `reprendre` ; lecture en échec : jamais de reprise à l'aveugle.
    actions: actionsFor(u, statut, droits, todayIn(config.timeZone, now), statut === 'Validé' && dossierEtat?.etat === 'absent'),
    historique: historiqueDe({
      enregistre: config.history !== undefined,
      createdDateTime: u.createdDateTime,
      lastPasswordChange: u.lastPasswordChange,
      createur,
      evenements,
      noms,
      authenticator,
      dates: datesAuthenticator(methodes),
      motDePasse,
    }),
  };
  audit.track({ action: 'demande.detail', actor, outcome: 'ok', cible: id, statut });
  return detail;
}
