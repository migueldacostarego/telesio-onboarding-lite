import { formatArriveeCourte } from '@/lib/dates';
import type { Demande } from '@/lib/suivi';

export interface SousTitre {
  texte: string;
  /** Ce qui demande une action ou ne va pas : rendu en rouge (jamais par la couleur seule : le texte le dit). */
  alerte?: boolean;
}

/**
 * Une ligne qui dit où en est la demande et ce qu'on attend, d'après ce que `GET /api/suivi` fournit (statut, actions, onboarding,
 * date d'arrivée) : rien d'inventé, aucun calcul de jour J (c'est `actions` qui le dit).
 */
export function sousTitre(d: Pick<Demande, 'statut' | 'actions' | 'onboarding' | 'dateArrivee'>, aujourdhui: string): SousTitre {
  switch (d.statut) {
    case 'EnAttente':
      return { texte: 'En attente de la direction' };
    case 'Validé':
      if (d.actions.includes('reprendre')) return { texte: 'Dossier SharePoint à refaire', alerte: true };
      if (d.actions.includes('activer')) return { texte: 'À activer maintenant' };
      if (d.dateArrivee && d.dateArrivee > aujourdhui) return { texte: `Activation le ${formatArriveeCourte(d.dateArrivee)}` };
      return { texte: 'Prête pour l’arrivée' };
    case 'Actif': {
      const o = d.onboarding;
      if (!o) return { texte: 'En attente de la 1re connexion' };
      if ('verification' in o) return { texte: 'État de l’onboarding illisible', alerte: true };
      if (o.termine) return { texte: 'Tout est fait, clôture en cours' };
      if (o.authenticator) return { texte: 'Mot de passe à changer' };
      if (o.motDePasse) return { texte: 'Authenticator à inscrire' };
      return { texte: 'En attente de la 1re connexion' };
    }
    case 'Terminé':
      return { texte: 'Onboarding terminé' };
  }
}
