import { createContext, useContext } from 'react';
import type { ActionsDemandes } from '@/hooks/useActionsDemandes';
import type { ActionNom } from '@/lib/actions';
import type { Demande, FiltreStatut, Tri, useSuivi } from '@/lib/suivi';

/**
 * Ce que la liste et la page de détail partagent. Tout vit **au-dessus des routes** : naviguer de l'une à l'autre ne perd ni un
 * spinner, ni un nouvel essai planifié, ni une erreur de ligne, ni la boîte du mot de passe temporaire (qui reste ouverte), et
 * « retour » retrouve la recherche, le filtre et le tri. Rien de cela ne va dans l'adresse ni dans le stockage du navigateur.
 */
export interface ContexteDemandes {
  suivi: ReturnType<typeof useSuivi>;
  actions: ActionsDemandes;
  /** Un bouton d'action a été cliqué : valider et reprendre partent tout de suite, les autres ouvrent d'abord une boîte de dialogue. */
  surAction: (d: Demande, action: ActionNom) => void;
  terme: string;
  setTerme: (terme: string) => void;
  statut: FiltreStatut;
  setStatut: (statut: FiltreStatut) => void;
  tri: Tri;
  setTri: (tri: Tri) => void;
}

export const Contexte = createContext<ContexteDemandes | null>(null);

export function useDemandes(): ContexteDemandes {
  const ctx = useContext(Contexte);
  if (!ctx) throw new Error('useDemandes : hors de FournisseurDemandes');
  return ctx;
}
