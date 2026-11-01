import type { EtatLigne } from '@/lib/actions';
import type { Acteur, DemandeDetail } from '@/lib/detail';
import { formatArrivee, onboardingComplet, type EtatOnboarding } from '@/lib/suivi';

export type EtatJalon = 'fait' | 'en_cours' | 'echec' | 'a_venir';

export const LIBELLES_JALON: Record<EtatJalon, string> = {
  fait: 'Fait',
  en_cours: 'En cours',
  echec: 'En échec',
  a_venir: 'À venir',
};

export interface Jalon {
  cle: 'creee' | 'validee' | 'activee' | 'regeneration' | 'authenticator' | 'motDePasse' | 'terminee';
  titre: string;
  etat: EtatJalon;
  /** Sous-étape de l'onboarding de l'arrivant (Authenticator, mot de passe), rangée sous « Activée ». */
  sous?: true;
  /** Date ISO (affichée en heure de Paris) ; `null` : l'étape est faite mais la date est inconnue ; absent : rien à dire. */
  le?: string | null;
  /** Qui : « Camille », « un compte supprimé », « le serveur » ; absent : rien à dire. */
  par?: string;
  /** Une phrase d'explication quand l'état en demande une. */
  detail?: string;
}

/** Texte de l'auteur d'une étape : le nom affiché, ou ce qu'on sait quand il manque (compte supprimé, tâche du serveur). */
export function texteActeur(a: Acteur | null | undefined): string | undefined {
  if (!a) return undefined;
  if (a.systeme) return 'le serveur (automatiquement)';
  return a.nom ?? 'un compte supprimé';
}

export interface EntreeChronologie {
  detail: DemandeDetail;
  /** Étape de la ligne de la liste quand elle est plus avancée que la lecture du détail (réplication d'Entra : lib/synchro.ts). */
  etape: number;
  onboarding: EtatOnboarding | undefined;
  /** Actions que l'API propose à la personne (`reprendre` : dossier SharePoint absent). */
  actions: readonly string[];
  /** Issue de la dernière action tentée sur la ligne. */
  etat?: EtatLigne;
}

const echecDe = (etat: EtatLigne | undefined, action: 'valider' | 'activer') => etat?.phase === 'erreur' && etat.action === action;

/** Ce que la lecture de l'onboarding dit : `verificationImpossible` (Graph a échoué), ou `lu`, l'état d'un compte Actif. */
function lectureOnboarding(onboarding: EtatOnboarding | undefined) {
  return {
    verificationImpossible: onboarding !== undefined && 'verification' in onboarding,
    lu: onboarding !== undefined && 'termine' in onboarding ? onboarding : undefined,
  };
}

export function jalonCreee({ detail }: EntreeChronologie): Jalon {
  const { creation } = detail.historique;
  return {
    cle: 'creee',
    titre: 'Demande créée',
    etat: 'fait',
    le: creation.le,
    par: texteActeur(creation.par),
    ...(creation.par === null ? { detail: 'Auteur non enregistré.' } : {}),
  };
}

export function jalonValidee({ detail, etape: n, actions, etat }: EntreeChronologie): Jalon {
  const h = detail.historique;
  const validee: Jalon = { cle: 'validee', titre: 'Validée par la direction', etat: n >= 2 ? 'fait' : 'en_cours' };
  if (n >= 2) Object.assign(validee, { le: h.validation?.le ?? null, par: texteActeur(h.validation?.par) });
  // Compte Validé dont le dossier SharePoint manque : la validation n'est pas terminée tant que le dossier n'existe pas.
  if (n === 2 && actions.includes('reprendre')) {
    validee.etat = 'echec';
    validee.detail = 'Le dossier SharePoint n’a pas été créé : réessayer.';
    if (etat?.phase === 'en_cours' && etat.action === 'reprendre') Object.assign(validee, { etat: 'en_cours', detail: 'Création du dossier en cours.' } satisfies Partial<Jalon>);
    if (etat?.phase === 'erreur' && etat.action === 'reprendre') validee.detail = 'La nouvelle tentative a échoué : voir le message, puis réessayer.';
  }
  if (n < 2) {
    if (echecDe(etat, 'valider')) Object.assign(validee, { etat: 'echec', detail: 'La validation a échoué : voir le message, puis réessayer.' } satisfies Partial<Jalon>);
    else if (etat?.phase === 'compte_en_creation') validee.detail = 'Compte en cours de création : nouvel essai automatique.';
    else if (etat?.phase === 'licence_en_cours') validee.detail = 'Licence en cours d’attribution : revalidation automatique.';
    else if (etat?.phase === 'licence_lente') validee.detail = 'La licence tarde à être attribuée : revalider dans quelques minutes.';
    else validee.detail = 'En attente de la direction.';
  }
  return validee;
}

export function jalonActivee({ detail, etape: n, etat }: EntreeChronologie): Jalon {
  const h = detail.historique;
  const activee: Jalon = { cle: 'activee', titre: 'Compte activé', etat: n >= 3 ? 'fait' : n === 2 ? 'en_cours' : 'a_venir' };
  if (n >= 3) Object.assign(activee, { le: h.activation?.le ?? null, par: texteActeur(h.activation?.par) });
  if (n === 2) {
    if (echecDe(etat, 'activer')) Object.assign(activee, { etat: 'echec', detail: 'L’activation a échoué : voir le message, puis réessayer.' } satisfies Partial<Jalon>);
    else activee.detail = detail.dateArrivee ? `À activer le jour de l’arrivée (${formatArrivee(detail.dateArrivee)}).` : 'À activer le jour de l’arrivée (date non renseignée).';
  }
  return activee;
}

/** Présent seulement si le mot de passe a été régénéré après l'activation. */
export function jalonRegeneration({ detail, etape: n }: EntreeChronologie): Jalon | null {
  const { regeneration } = detail.historique;
  if (n < 3 || !regeneration) return null;
  const { nombre } = regeneration;
  return {
    cle: 'regeneration',
    titre: nombre > 1 ? `Mot de passe régénéré (${nombre} fois, dernière remise)` : 'Mot de passe régénéré',
    etat: 'fait',
    sous: true,
    le: regeneration.le,
    par: texteActeur(regeneration.par),
  };
}

/** Sous-étape de l'arrivant : présente une fois le compte activé. Ordre constaté sur le tenant de test : Authenticator d'abord, puis le changement du mot de passe. */
export function jalonAuthenticator({ detail, etape: n, onboarding }: EntreeChronologie): Jalon | null {
  if (n < 3) return null;
  const { verificationImpossible, lu } = lectureOnboarding(onboarding);
  const authenticator: Jalon = { cle: 'authenticator', titre: 'Authenticator inscrit', etat: 'a_venir', sous: true };
  const inscrit = detail.historique.authenticator;
  if (inscrit || lu?.authenticator) {
    authenticator.etat = 'fait';
    authenticator.le = inscrit?.le ?? null;
    if (authenticator.le === null) authenticator.detail = 'Date non fournie par Entra.';
  } else if (verificationImpossible) {
    Object.assign(authenticator, { etat: 'echec', detail: 'Lecture impossible : relue à la prochaine actualisation.' } satisfies Partial<Jalon>);
  } else if (n === 4) {
    Object.assign(authenticator, { etat: 'fait', le: null });
  } else {
    authenticator.detail = 'À la première connexion de l’arrivant.';
  }
  return authenticator;
}

export function jalonMotDePasse({ detail, etape: n, onboarding }: EntreeChronologie): Jalon | null {
  if (n < 3) return null;
  const { verificationImpossible, lu } = lectureOnboarding(onboarding);
  const motDePasse: Jalon = { cle: 'motDePasse', titre: 'Mot de passe changé par l’arrivant', etat: 'a_venir', sous: true };
  const change = detail.historique.motDePasse;
  if (change || lu?.motDePasse) {
    motDePasse.etat = 'fait';
    motDePasse.le = change?.le ?? null;
  } else if (n === 4) {
    Object.assign(motDePasse, { etat: 'fait', le: null });
  } else if (!verificationImpossible) {
    motDePasse.detail = 'Après l’inscription d’Authenticator.';
  }
  return motDePasse;
}

export function jalonTerminee({ detail, etape: n, onboarding }: EntreeChronologie): Jalon {
  const terminee: Jalon = { cle: 'terminee', titre: 'Onboarding terminé', etat: n >= 4 ? 'fait' : n === 3 ? 'en_cours' : 'a_venir' };
  if (n >= 4) Object.assign(terminee, { le: detail.historique.termine?.le ?? null, par: texteActeur(detail.historique.termine?.par) });
  if (n === 3) {
    if (onboarding && 'verification' in onboarding) {
      Object.assign(terminee, { etat: 'echec', detail: 'L’état du mot de passe et d’Authenticator n’a pas pu être lu : il sera relu à la prochaine actualisation.' } satisfies Partial<Jalon>);
    } else if (onboardingComplet(onboarding)) {
      terminee.detail = 'Tout est fait : le serveur passe le compte à Terminé automatiquement (vérification toutes les 5 minutes).';
    }
  }
  return terminee;
}

/**
 * La chronologie d'une demande, d'après ce que `GET /api/demandes/:id` fournit et l'issue de la dernière action tentée dans
 * l'écran. Une étape « en échec » vient de deux sources seulement : l'action qui y mène vient d'échouer, ou la lecture de
 * l'onboarding a échoué. Une étape faite avant l'enregistrement de l'historique a `le: null` : elle est dite « non enregistrée »,
 * jamais inventée.
 */
export function chronologie(entree: EntreeChronologie): Jalon[] {
  const jalons = [
    jalonCreee(entree),
    jalonValidee(entree),
    jalonActivee(entree),
    jalonRegeneration(entree),
    jalonAuthenticator(entree),
    jalonMotDePasse(entree),
    jalonTerminee(entree),
  ];
  return jalons.filter((j): j is Jalon => j !== null);
}
