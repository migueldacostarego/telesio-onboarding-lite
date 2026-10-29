import type { PropsActions } from '@/components/demandes/ActionsLigne';
import type { ActionNom, EtatLigne } from '@/lib/actions';
import type { Demande } from '@/lib/suivi';

/** Ce que le tableau (bureau) et les cartes (mobile) reçoivent de la page : les demandes, l'état de chaque ligne et les actions. */
export interface PropsLignes {
  demandes: readonly Demande[];
  etats: Readonly<Record<string, EtatLigne>>;
  /** Un bouton de ligne a été cliqué (valider part tout de suite ; les autres ouvrent d'abord une boîte de dialogue). */
  onAction: (d: Demande, action: ActionNom) => void;
  onFermer: (d: Demande) => void;
}

export const actionsDe = (d: Demande, p: PropsLignes): PropsActions => ({
  demande: d,
  etat: p.etats[d.id],
  onAction: (action) => p.onAction(d, action),
});

/** La ligne porte un message sous elle (erreur ou licence lente). */
export const aUnMessage = (p: PropsLignes, d: Demande): boolean => {
  const phase = p.etats[d.id]?.phase;
  return phase === 'erreur' || phase === 'licence_lente';
};
