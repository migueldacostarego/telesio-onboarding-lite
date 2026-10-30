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

/**
 * La chronologie d'une demande, d'après ce que `GET /api/demandes/:id` fournit et l'issue de la dernière action tentée dans
 * l'écran. Une étape « en échec » vient de deux sources seulement : l'action qui y mène vient d'échouer, ou la lecture de
 * l'onboarding a échoué. Une étape faite avant l'enregistrement de l'historique a `le: null` : elle est dite « non enregistrée »,
 * jamais inventée.
 */
export function chronologie({ detail, etape: n, onboarding, actions, etat }: EntreeChronologie): Jalon[] {
  const h = detail.historique;
  const echecDe = (action: 'valider' | 'activer') => etat?.phase === 'erreur' && etat.action === action;
  const jalons: Jalon[] = [];

  jalons.push({
    cle: 'creee',
    titre: 'Demande créée',
    etat: 'fait',
    le: h.creation.le,
    par: texteActeur(h.creation.par),
    ...(h.creation.par === null ? { detail: 'Auteur non enregistré.' } : {}),
  });

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
    if (echecDe('valider')) Object.assign(validee, { etat: 'echec', detail: 'La validation a échoué : voir le message, puis réessayer.' } satisfies Partial<Jalon>);
    else if (etat?.phase === 'compte_en_creation') validee.detail = 'Compte en cours de création : nouvel essai automatique.';
    else if (etat?.phase === 'licence_en_cours') validee.detail = 'Licence en cours d’attribution : revalidation automatique.';
    else if (etat?.phase === 'licence_lente') validee.detail = 'La licence tarde à être attribuée : revalider dans quelques minutes.';
    else validee.detail = 'En attente de la direction.';
  }
  jalons.push(validee);

  const activee: Jalon = { cle: 'activee', titre: 'Compte activé', etat: n >= 3 ? 'fait' : n === 2 ? 'en_cours' : 'a_venir' };
  if (n >= 3) Object.assign(activee, { le: h.activation?.le ?? null, par: texteActeur(h.activation?.par) });
  if (n === 2) {
    if (echecDe('activer')) Object.assign(activee, { etat: 'echec', detail: 'L’activation a échoué : voir le message, puis réessayer.' } satisfies Partial<Jalon>);
    else activee.detail = detail.dateArrivee ? `À activer le jour de l’arrivée (${formatArrivee(detail.dateArrivee)}).` : 'À activer le jour de l’arrivée (date non renseignée).';
  }
  jalons.push(activee);

  if (n >= 3 && h.regeneration) {
    const { nombre } = h.regeneration;
    jalons.push({
      cle: 'regeneration',
      titre: nombre > 1 ? `Mot de passe régénéré (${nombre} fois, dernière remise)` : 'Mot de passe régénéré',
      etat: 'fait',
      sous: true,
      le: h.regeneration.le,
      par: texteActeur(h.regeneration.par),
    });
  }

  if (n >= 3) {
    const verificationImpossible = onboarding !== undefined && 'verification' in onboarding;
    const lu = onboarding !== undefined && 'termine' in onboarding ? onboarding : undefined;
    // Ordre constaté sur le tenant de test : Authenticator d'abord, puis le changement du mot de passe.
    const authenticator: Jalon = { cle: 'authenticator', titre: 'Authenticator inscrit', etat: 'a_venir', sous: true };
    if (h.authenticator || lu?.authenticator) {
      authenticator.etat = 'fait';
      authenticator.le = h.authenticator?.le ?? null;
      if (authenticator.le === null) authenticator.detail = 'Date non fournie par Entra.';
    } else if (verificationImpossible) {
      Object.assign(authenticator, { etat: 'echec', detail: 'Lecture impossible : relue à la prochaine actualisation.' } satisfies Partial<Jalon>);
    } else if (n === 4) {
      Object.assign(authenticator, { etat: 'fait', le: null });
    } else {
      authenticator.detail = 'À la première connexion de l’arrivant.';
    }
    const motDePasse: Jalon = { cle: 'motDePasse', titre: 'Mot de passe changé par l’arrivant', etat: 'a_venir', sous: true };
    if (h.motDePasse || lu?.motDePasse) {
      motDePasse.etat = 'fait';
      motDePasse.le = h.motDePasse?.le ?? null;
    } else if (n === 4) {
      Object.assign(motDePasse, { etat: 'fait', le: null });
    } else if (!verificationImpossible) {
      motDePasse.detail = 'Après l’inscription d’Authenticator.';
    }
    jalons.push(authenticator, motDePasse);
  }

  const terminee: Jalon = { cle: 'terminee', titre: 'Onboarding terminé', etat: n >= 4 ? 'fait' : n === 3 ? 'en_cours' : 'a_venir' };
  if (n >= 4) Object.assign(terminee, { le: h.termine?.le ?? null, par: texteActeur(h.termine?.par) });
  if (n === 3) {
    if (onboarding && 'verification' in onboarding) {
      Object.assign(terminee, { etat: 'echec', detail: 'L’état du mot de passe et d’Authenticator n’a pas pu être lu : il sera relu à la prochaine actualisation.' } satisfies Partial<Jalon>);
    } else if (onboardingComplet(onboarding)) {
      terminee.detail = 'Tout est fait : le serveur passe le compte à Terminé automatiquement (vérification toutes les 5 minutes).';
    }
  }
  jalons.push(terminee);
  return jalons;
}
