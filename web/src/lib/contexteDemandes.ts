import { createContext, useContext } from 'react';
import type { ActionsDemandes } from '@/hooks/useActionsDemandes';
import type { ActionNom } from '@/lib/actions';
import type { useDemande } from '@/lib/detail';
import type { Demande, FiltreGroupe, Tri, useSuivi } from '@/lib/suivi';

/** Demande que l'écran vient de créer : son id (ligne en évidence ; '' quand le surlignage est fini) et l'avertissement du serveur. */
export interface Nouvelle {
  id: string;
  nom: string;
  avertissement?: string;
}

/**
 * Ce que la liste et la page de détail partagent. Tout vit **au-dessus des routes** : naviguer de l'une à l'autre ne perd ni un
 * spinner, ni un nouvel essai planifié, ni une erreur de ligne, ni la boîte du mot de passe temporaire (qui reste ouverte), et
 * « retour » retrouve la recherche, le filtre et le tri. Rien de cela ne va dans l'adresse ni dans le stockage du navigateur.
 */
export interface ContexteDemandes {
  suivi: ReturnType<typeof useSuivi>;
  /** Sur `/demandes/:id` : la lecture de `GET /api/demandes/:id` (inactive ailleurs). */
  detail: ReturnType<typeof useDemande>;
  /** Sur `/demandes/:id` : la ligne de la liste, telle que `GET /api/suivi` la rend (absente si la liste ne la contient pas). */
  ligneListe: Demande | undefined;
  /** Sur `/demandes/:id` : la ligne qui porte les actions de la page (lib/detailDemande.ts, `ligneDuDetail`). */
  ligneDetail: Demande | undefined;
  actions: ActionsDemandes;
  /** Gardée au-dessus des routes : l'avertissement « ne renvoyez pas la demande » survit à une visite du détail. */
  nouvelle: Nouvelle | null;
  setNouvelle: (n: Nouvelle | null | ((n: Nouvelle | null) => Nouvelle | null)) => void;
  /** Un bouton d'action a été cliqué : valider et reprendre partent tout de suite, les autres ouvrent d'abord une boîte de dialogue. */
  surAction: (d: Demande, action: ActionNom) => void;
  terme: string;
  setTerme: (terme: string) => void;
  groupe: FiltreGroupe;
  setGroupe: (groupe: FiltreGroupe) => void;
  tri: Tri;
  setTri: (tri: Tri) => void;
}

export const Contexte = createContext<ContexteDemandes | null>(null);

export function useDemandes(): ContexteDemandes {
  const ctx = useContext(Contexte);
  if (!ctx) throw new Error('useDemandes : hors de FournisseurDemandes');
  return ctx;
}
