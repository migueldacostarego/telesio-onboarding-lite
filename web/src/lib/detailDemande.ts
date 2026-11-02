import type { DemandeDetail } from '@/lib/detail';
import type { Demande, EtatOnboarding, Statut } from '@/lib/suivi';

/** Ce que la page affiche une fois la lecture du détail et la ligne de la liste mises d'accord. */
export interface VueDetail {
  etape: number;
  statut: Statut;
  onboarding: EtatOnboarding | undefined;
  actions: readonly string[];
}

/** La liste peut être plus avancée que le détail juste après une action (réplication d'Entra) : elle fait foi pour l'étape. */
export function reconcilier(d: DemandeDetail, ligne: Demande | undefined): VueDetail {
  return {
    etape: Math.max(d.etape, ligne?.etape ?? 0),
    statut: ligne && ligne.etape > d.etape ? ligne.statut : d.statut,
    onboarding: ligne?.synchro ? ligne.onboarding : (d.onboarding ?? ligne?.onboarding),
    actions: ligne?.actions ?? d.actions,
  };
}

/** « Comptable · Finance », l'un ou l'autre seul, ou « Poste non renseigné ». */
export function intitulePoste({ poste, service }: Pick<DemandeDetail, 'poste' | 'service'>): string {
  return [poste, service].filter(Boolean).join(' · ') || 'Poste non renseigné';
}
