import type { PropsActions } from '@/components/demandes/ActionsLigne';
import { verrouille, type ActionNom, type EtatLigne } from '@/lib/actions';
import type { Demande } from '@/lib/suivi';

/** Ce que le tableau (bureau) et les cartes (mobile) reçoivent de la page : les demandes, l'état de chaque ligne et les actions. */
export interface PropsLignes {
  demandes: readonly Demande[];
  etats: Readonly<Record<string, EtatLigne>>;
  /** Un bouton de ligne a été cliqué (valider part tout de suite ; les autres ouvrent d'abord une boîte de dialogue). */
  onAction: (d: Demande, action: ActionNom) => void;
  onFermer: (d: Demande) => void;
  /** Ouvre le panneau de détail (clic sur la ligne ou sur le nom). */
  onOuvrir: (d: Demande) => void;
  /** Demande qui vient d'être créée : mise en évidence. */
  surlignee?: string | null;
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

/** Une action tourne pour cette ligne : rien d'autre n'y est cliquable, l'ouverture du détail comprise. */
export const occupee = (p: PropsLignes, d: Demande): boolean => verrouille(p.etats[d.id]);

/** Clic sur la ligne : ouvre le détail, sauf quand il vient d'un bouton ou d'un champ de la ligne. */
export const ouvrirSiLigne = (e: { target: EventTarget }, ouvrir: () => void): void => {
  if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
  ouvrir();
};
