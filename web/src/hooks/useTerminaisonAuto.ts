import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { SUIVI_KEY, onboardingComplet, type Demande } from '@/lib/suivi';

/** Tentatives par demande et par ouverture de l'écran : une panne durable ne doit pas relancer une écriture toutes les 30 s. */
export const TENTATIVES_TERMINER_MAX = 5;

/**
 * Passage à Terminé : l'API ne le fait jamais seule (`POST /terminer`, jamais une liste). Après chaque chargement de la liste,
 * pour les comptes Actif dont l'API dit que le mot de passe a changé et qu'Authenticator est inscrit, et seulement pour une
 * personne à qui l'API propose `regenerer` (donc le droit `activer`), l'écran appelle `terminer`. Le serveur revérifie tout :
 * un 409 (`onboarding_non_termine`) est normal et silencieux, la liste suivante (30 s) retente. Rien n'est affiché : le
 * compte passe seul à « Terminée » à la liste d'après.
 */
export function useTerminaisonAuto(demandes: readonly Demande[] | undefined, lueA: number): void {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({ mutationFn: (id: string) => api.post(`/api/demandes/${encodeURIComponent(id)}/terminer`) });
  const tentatives = useRef(new Map<string, number>());
  const enCours = useRef(new Set<string>());

  useEffect(() => {
    for (const d of demandes ?? []) {
      const eligible = d.statut === 'Actif' && d.actions.includes('regenerer') && onboardingComplet(d.onboarding);
      if (!eligible || enCours.current.has(d.id) || (tentatives.current.get(d.id) ?? 0) >= TENTATIVES_TERMINER_MAX) continue;
      tentatives.current.set(d.id, (tentatives.current.get(d.id) ?? 0) + 1);
      enCours.current.add(d.id);
      mutateAsync(d.id)
        .then(() => queryClient.invalidateQueries({ queryKey: SUIVI_KEY }))
        .catch(() => undefined) // 409 attendu tant que le serveur ne confirme pas ; 401 : géré par la MutationCache
        .finally(() => enCours.current.delete(d.id));
    }
  // `lueA` : chaque lecture réussie relance l'examen, même si les données sont identiques (références conservées par TanStack).
  }, [demandes, lueA, mutateAsync, queryClient]);
}
