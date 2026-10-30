import type { EtatLigne } from '@/lib/actions';
import { formatArrivee, onboardingComplet, type Demande } from '@/lib/suivi';

export type EtatEtape = 'reussie' | 'en_cours' | 'echec' | 'a_venir';

export interface SousEtat {
  libelle: string;
  fait: boolean;
}

export interface Etape {
  cle: 'creee' | 'validee' | 'activee' | 'terminee';
  libelle: string;
  etat: EtatEtape;
  /** Une phrase d'explication, quand l'état en demande une. */
  detail?: string;
  /** Sous-états d'onboarding (comptes Actif seulement, d'après `onboarding` de l'API). */
  sousEtats?: SousEtat[];
}

export const LIBELLES_ETAT: Record<EtatEtape, string> = {
  reussie: 'Réussie',
  en_cours: 'En cours',
  echec: 'En échec',
  a_venir: 'À venir',
};

/**
 * Les quatre étapes d'une demande, d'après ce que `GET /api/suivi` fournit déjà (`etape`, `statut`, `onboarding`, `dateArrivee`)
 * et l'issue de la dernière action tentée sur la ligne (`etat`) : aucune donnée de plus, aucune permission Graph de plus.
 * Une étape est « en échec » quand l'action qui y mène vient d'échouer (valider, activer) ou que l'état d'onboarding n'a pas pu
 * être lu ; l'échec d'un refus ou d'une régénération n'est pas celui d'une étape (le message d'erreur est dans la ligne).
 */
export function etapesDe(d: Pick<Demande, 'etape' | 'dateArrivee' | 'onboarding'> & { actions?: readonly string[] }, etat?: EtatLigne): Etape[] {
  const n = d.etape;
  const echecDe = (action: 'valider' | 'activer') => etat?.phase === 'erreur' && etat.action === action;

  const validee: Etape = { cle: 'validee', libelle: 'Validée', etat: n >= 2 ? 'reussie' : 'en_cours' };
  // Compte Validé dont le dossier SharePoint manque : l'API propose `reprendre`. La validation n'est pas terminée tant que le dossier n'existe pas.
  if (n === 2 && d.actions?.includes('reprendre')) {
    validee.etat = 'echec';
    validee.detail = 'Le dossier SharePoint n’a pas été créé : réessayer.';
    if (etat?.phase === 'en_cours' && etat.action === 'reprendre') Object.assign(validee, { etat: 'en_cours', detail: 'Création du dossier en cours.' } satisfies Partial<Etape>);
    if (etat?.phase === 'erreur' && etat.action === 'reprendre') validee.detail = 'La nouvelle tentative a échoué : voir le message, puis réessayer.';
  }
  if (n < 2) {
    if (echecDe('valider')) Object.assign(validee, { etat: 'echec', detail: 'La validation a échoué : voir le message, puis réessayer.' } satisfies Partial<Etape>);
    else if (etat?.phase === 'compte_en_creation') validee.detail = 'Compte en cours de création : nouvel essai automatique.';
    else if (etat?.phase === 'licence_en_cours') validee.detail = 'Licence en cours d’attribution : revalidation automatique.';
    else if (etat?.phase === 'licence_lente') validee.detail = 'La licence tarde à être attribuée : revalider dans quelques minutes.';
    else validee.detail = 'En attente de la direction.';
  }

  const activee: Etape = { cle: 'activee', libelle: 'Activée', etat: n >= 3 ? 'reussie' : n === 2 ? 'en_cours' : 'a_venir' };
  if (n === 2) {
    if (echecDe('activer')) Object.assign(activee, { etat: 'echec', detail: 'L’activation a échoué : voir le message, puis réessayer.' } satisfies Partial<Etape>);
    else activee.detail = d.dateArrivee ? `À activer le jour de l’arrivée (${formatArrivee(d.dateArrivee)}).` : 'À activer le jour de l’arrivée (date non renseignée).';
  }

  const terminee: Etape = { cle: 'terminee', libelle: 'Terminée', etat: n >= 4 ? 'reussie' : n === 3 ? 'en_cours' : 'a_venir' };
  if (n === 3) {
    const o = d.onboarding;
    if (o && 'verification' in o) {
      terminee.etat = 'echec';
      terminee.detail = 'L’état du mot de passe et d’Authenticator n’a pas pu être lu : il sera relu à la prochaine actualisation.';
    } else if (o) {
      // Ordre constaté sur le tenant de test : Authenticator d'abord, puis le changement du mot de passe.
      terminee.sousEtats = [
        { libelle: 'Authenticator inscrit', fait: o.authenticator },
        { libelle: 'Mot de passe changé', fait: o.motDePasse },
      ];
      terminee.detail = onboardingComplet(o) ? 'Tout est fait : le passage à Terminée est automatique.' : 'À la première connexion de l’arrivant.';
    }
  }

  return [{ cle: 'creee', libelle: 'Demande créée', etat: 'reussie' }, validee, activee, terminee];
}
