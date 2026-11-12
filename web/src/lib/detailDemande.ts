import type { DemandeDetail } from '@/lib/detail';
import type { Demande, EtatOnboarding, Statut } from '@/lib/suivi';

/** Ce que la page affiche une fois la lecture du détail et la ligne de la liste mises d'accord. */
export interface VueDetail {
  etape: number;
  statut: Statut;
  onboarding: EtatOnboarding | undefined;
  actions: readonly string[];
}

/**
 * La ligne de la liste fait foi pour les actions si elle est plus avancée que le détail (réplication d'Entra juste après une action),
 * ou à la même étape, sauf si elle est en synchronisation : ses actions sont alors inconnues du client (aucune), celles du détail
 * viennent du serveur. Le détail plus avancé (liste en retard) l'emporte.
 */
const listeDevant = (d: DemandeDetail, ligne: Demande | undefined): ligne is Demande =>
  ligne !== undefined && (ligne.etape > d.etape || (ligne.etape === d.etape && ligne.synchro !== true));

/** La liste peut être plus avancée que le détail juste après une action (réplication d'Entra) : elle fait foi pour l'étape. */
export function reconcilier(d: DemandeDetail, ligne: Demande | undefined): VueDetail {
  return {
    etape: Math.max(d.etape, ligne?.etape ?? 0),
    statut: ligne && ligne.etape > d.etape ? ligne.statut : d.statut,
    onboarding: ligne?.synchro ? ligne.onboarding : (d.onboarding ?? ligne?.onboarding),
    actions: listeDevant(d, ligne) ? ligne.actions : d.actions,
  };
}

/**
 * La ligne qui porte les actions de la page de détail (boutons, boîtes de dialogue, état de l'action) : celle de la liste quand elle
 * fait foi (`listeDevant`), sinon une ligne construite d'après le détail. C'est le cas d'une demande absente de la liste (liste
 * tronquée à 100 par statut) ou d'une liste en retard sur le détail.
 */
export function ligneDuDetail(d: DemandeDetail, ligne: Demande | undefined): Demande {
  if (listeDevant(d, ligne)) return ligne;
  return {
    id: d.id,
    nom: d.nom,
    upn: d.upn,
    poste: d.poste,
    service: d.service,
    typeContrat: d.typeContrat ?? null,
    dateArrivee: d.dateArrivee,
    statut: d.statut,
    etape: d.etape,
    actions: d.actions,
    ...(d.onboarding ? { onboarding: d.onboarding } : {}),
  };
}

/** « Comptable · Finance », l'un ou l'autre seul, ou « Poste non renseigné ». */
export function intitulePoste({ poste, service }: Pick<DemandeDetail, 'poste' | 'service'>): string {
  return [poste, service].filter(Boolean).join(' · ') || 'Poste non renseigné';
}
