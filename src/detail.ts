import type { Droits } from './auth';
import { motDePasseChange, activationConfig, type ActivationDeps, type OnboardingState } from './activation';
import { todayIn } from './dates';
import { ServiceError } from './demandes';
import type { DirectionDeps } from './direction';
import { graphFailureProps, type DemandeLue, type LicenseRead } from './directory';
import { buildFolderName } from './folder';
import { ACTEUR_SYSTEME, decoderEvenement, type Evenement } from './history';
import { STATUTS, actionsFor, type Statut, type SuiviAction } from './suivi';

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
export async function lireDemande(deps: DetailDeps, actor: string, id: string, now: Date, droits: Droits): Promise<DemandeDetail> {
  const { config, directory, audit, library } = deps;
  const { activationExt } = activationConfig(deps);
  const h = config.history;
  const exts = [config.statusExtension, activationExt, ...(config.licenseExtension ? [config.licenseExtension] : []), ...(config.creatorExtension ? [config.creatorExtension] : []), ...(h ? [h.validation, h.activation, h.regeneration, h.termine] : [])];

  let u: DemandeLue | null;
  try {
    u = await directory.getDemande(id, exts);
  } catch (err) {
    audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape: 'detail_lecture', cible: id, ...graphFailureProps(err) });
    throw new ServiceError(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'detail_lecture' });
  }
  const statutBrut = u?.extensions[config.statusExtension] ?? null;
  const statut = (STATUTS as readonly string[]).includes(statutBrut ?? '') ? (statutBrut as Statut) : null;
  if (!u || statut === null) {
    audit.track({ action: 'demande.introuvable', actor, outcome: 'refuse', cible: id });
    throw new ServiceError(404, { error: 'Demande introuvable' });
  }

  /** Lecture annexe : un échec est tracé et rend `repli`, la page reste affichée. */
  const doux = async <T>(etape: string, repli: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      audit.track({ action: 'demande.echec', actor, outcome: 'erreur', etape, cible: id, ...graphFailureProps(err) });
      return repli;
    }
  };

  const evt = (ext: string | undefined) => decoderEvenement(ext ? u.extensions[ext] : null);
  const validation = evt(h?.validation);
  const activation = evt(h?.activation);
  const regeneration = evt(h?.regeneration);
  const termine = evt(h?.termine);
  const createur = config.creatorExtension ? (u.extensions[config.creatorExtension] ?? null) : null;

  // Noms des auteurs : un appel par objectId distinct (trois au plus), jamais tracés.
  const ids = [...new Set([createur, validation?.par, activation?.par, regeneration?.par, termine?.par].filter((x): x is string => !!x && x !== ACTEUR_SYSTEME).map((x) => x.toLowerCase()))];
  const noms = new Map<string, string | null>(await Promise.all(ids.map(async (a) => [a, await doux<string | null>('detail_acteur', null, () => directory.getDisplayName(a))] as const)));
  const acteur = (par: string | null): Acteur | null => (par === null ? null : par === ACTEUR_SYSTEME ? { nom: null, systeme: true } : { nom: noms.get(par.toLowerCase()) ?? null });
  const fait = (e: Evenement | null): EtapeFaite | null => (e ? { le: e.le, par: acteur(e.par) as Acteur } : null);

  const apresValidation = statut !== 'EnAttente';
  const actifOuTermine = statut === 'Actif' || statut === 'Terminé';

  const progress = { lastPasswordChange: u.lastPasswordChange, activation: u.extensions[activationExt] ?? null, createdDateTime: u.createdDateTime };
  const sku = config.licenseExtension ? (u.extensions[config.licenseExtension]?.toLowerCase() ?? null) : null;
  const option = config.licenses.find((l) => l.skuId === sku);
  const dossierNom = (() => {
    try {
      return buildFolderName(config.sharePoint.folderPattern, { nom: u.surname ?? '', prenom: u.givenName ?? '', id });
    } catch {
      return null;
    }
  })();

  const [methodes, groupe, etatLicence, dossier] = await Promise.all([
    actifOuTermine ? doux<{ createdDateTime: string | null }[] | null>('detail_authenticator', null, () => directory.listAuthenticatorMethods(id)) : Promise.resolve([]),
    statut === 'Terminé' ? Promise.resolve(false) : apresValidation && config.arrivantsGroupId ? doux<boolean | null>('detail_groupe', null, () => directory.isMemberOfGroup(id, config.arrivantsGroupId as string)) : Promise.resolve(null),
    apresValidation && sku ? doux<LicenseRead | null>('detail_licence', null, () => directory.readLicenseStates(id, sku)) : Promise.resolve(undefined),
    apresValidation && library && dossierNom ? doux<{ webUrl: string | null } | null | undefined>('detail_dossier', undefined, () => library.findFolder(dossierNom)) : Promise.resolve(undefined),
  ]);

  const authenticator = methodes === null ? null : methodes.length > 0;
  const dates = (methodes ?? []).map((m) => m.createdDateTime).filter((d): d is string => d !== null && Number.isFinite(Date.parse(d))).sort();
  const motDePasse = actifOuTermine && motDePasseChange(progress);

  let onboarding: DemandeDetail['onboarding'];
  if (statut === 'Actif') onboarding = authenticator === null ? { verification: 'echec' } : { motDePasse, authenticator, termine: motDePasse && authenticator };

  let licence: DemandeDetail['licence'] = null;
  if (sku) {
    const libelle = option?.libelle ?? null;
    if (!apresValidation) licence = { libelle, etat: 'choisie' };
    else if (etatLicence === null || etatLicence === undefined) licence = { libelle, etat: 'inconnu' };
    else if (etatLicence.entry === null) licence = { libelle, etat: 'en_cours' };
    else licence = { libelle, etat: etatLicence.entry.state === 'Active' && !etatLicence.entry.error ? 'attribuee' : 'erreur' };
  }

  // undefined : sans objet, non configuré, nom impossible à former ou lecture en échec ; null : lue et absente.
  const dossierEtat: DemandeDetail['dossier'] = dossier === undefined ? null : dossier === null ? { etat: 'absent' } : { etat: 'present', url: dossier.webUrl };
  const aujourdhui = todayIn(config.timeZone, now);
  const detail: DemandeDetail = {
    id: u.id,
    nom: u.displayName,
    upn: u.upn,
    poste: u.poste,
    service: u.service,
    manager: u.managerNom ? { nom: u.managerNom } : null,
    dateArrivee: u.dateArrivee,
    statut,
    etape: (STATUTS.indexOf(statut) + 1) as DemandeDetail['etape'],
    licence,
    groupeArrivants: groupe === null || groupe === undefined ? null : { membre: groupe },
    dossier: dossierEtat,
    ...(onboarding ? { onboarding } : {}),
    // Dossier prouvé absent (lecture réussie) : `reprendre` ; lecture en échec : jamais de reprise à l'aveugle.
    actions: actionsFor(u, statut, droits, aujourdhui, statut === 'Validé' && dossierEtat?.etat === 'absent'),
    historique: {
      enregistre: h !== undefined,
      creation: { le: u.createdDateTime, par: acteur(createur) },
      validation: fait(validation),
      activation: fait(activation),
      regeneration: regeneration ? { ...(fait(regeneration) as EtapeFaite), nombre: regeneration.nombre ?? 1 } : null,
      authenticator: authenticator ? { le: dates[0] ?? null } : null,
      motDePasse: motDePasse && u.lastPasswordChange ? { le: u.lastPasswordChange } : null,
      termine: fait(termine),
    },
  };
  audit.track({ action: 'demande.detail', actor, outcome: 'ok', cible: id, statut });
  return detail;
}
