import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  REESSAIS_COMPTE_MS,
  REVALIDATION_LICENCE_MS,
  REVALIDATIONS_LICENCE_MAX,
  cheminAction,
  estCompteIntrouvable,
  verrouille,
  type ActionNom,
  type EtatLigne,
} from '@/lib/actions';
import { isSessionExpiredError } from '@/lib/session';
import { SUIVI_KEY, type Demande } from '@/lib/suivi';

type Etats = Record<string, EtatLigne>;
interface Appel {
  id: string;
  action: ActionNom;
  motif?: string;
}
/** Combien de fois on a déjà rejoué pour chaque cause (compte pas encore répliqué, licence en cours). */
interface Rejeux {
  compte: number;
  licence: number;
}

const sans = (etats: Etats, id: string): Etats => {
  if (!(id in etats)) return etats;
  const suite = { ...etats };
  delete suite[id];
  return suite;
};

/** Ce qui ne peut plus durer : la demande a disparu, ou n'offre plus `approuver` (validée ou refusée ailleurs) pour une attente automatique. */
function nettoyer(etats: Etats, demandes: readonly Demande[] | undefined): Etats {
  if (!demandes) return etats;
  let suite = etats;
  for (const [id, etat] of Object.entries(etats)) {
    const demande = demandes.find((d) => d.id === id);
    const attente = etat.phase === 'compte_en_creation' || etat.phase === 'licence_en_cours';
    if (!demande || (attente && !demande.actions.includes('approuver'))) suite = sans(suite, id);
  }
  return suite;
}

/**
 * Actions de la direction sur les demandes (valider, refuser). L'état de chaque ligne vit ici, au niveau de la page, par id :
 * une recherche, un filtre ou le passage tableau / cartes démonte les lignes sans perdre un spinner, un nouvel essai planifié
 * ni une erreur, et sans permettre un second clic. Les écritures passent par une mutation TanStack (session expirée, `gcTime: 0`,
 * jamais rejouée par la bibliothèque) ; les deux seuls rejeux sont ceux, bornés, décrits dans `lib/actions.ts`.
 */
export function useActionsDemandes(demandes: readonly Demande[] | undefined) {
  const queryClient = useQueryClient();
  const [etats, setEtats] = useState<Etats>({});
  // Mise à jour de l'état d'après de nouvelles données, pendant le rendu (modèle de React) : pas de rendu intermédiaire fautif.
  const [precedentes, setPrecedentes] = useState(demandes);
  if (demandes !== precedentes) {
    setPrecedentes(demandes);
    const propre = nettoyer(etats, demandes);
    if (propre !== etats) setEtats(propre);
  }

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const courantes = useRef(demandes);
  const vivant = useRef(true);
  const { mutateAsync } = useMutation({
    mutationFn: ({ id, action, motif }: Appel) => api.post(cheminAction(id, action), action === 'refuser' ? { motif } : {}),
  });

  const poser = useCallback((id: string, etat?: EtatLigne) => {
    if (!vivant.current) return;
    setEtats((prev) => (etat === undefined ? sans(prev, id) : { ...prev, [id]: etat }));
  }, []);
  const annuler = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);
  const offre = (id: string) => courantes.current?.find((d) => d.id === id)?.actions.includes('approuver') === true;
  const planifier = (id: string, ms: number, suite: () => void) => {
    annuler(id);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        suite();
      }, ms),
    );
  };
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: SUIVI_KEY });

  // Données rafraîchies : une attente automatique dont la demande n'offre plus `approuver` (ou a disparu) est abandonnée.
  useEffect(() => {
    courantes.current = demandes;
    if (!demandes) return;
    for (const id of [...timers.current.keys()]) {
      if (!demandes.find((d) => d.id === id)?.actions.includes('approuver')) annuler(id);
    }
  }, [demandes, annuler]);
  useEffect(() => {
    vivant.current = true;
    const t = timers.current;
    return () => {
      vivant.current = false;
      for (const h of t.values()) clearTimeout(h);
      t.clear();
    };
  }, []);

  /** Une tentative. Rend la main dès que la réponse du serveur est connue ; la liste se rafraîchit ensuite. */
  const lancer = async (id: string, action: ActionNom, motif: string | undefined, rejeux: Rejeux): Promise<void> => {
    let res;
    try {
      res = await mutateAsync({ id, action, motif });
    } catch (error) {
      // 401 : l'application bascule seule sur l'écran de reconnexion (MutationCache).
      if (isSessionExpiredError(error)) return;
      if (action === 'valider' && estCompteIntrouvable(error)) {
        const delai = REESSAIS_COMPTE_MS[rejeux.compte];
        if (delai !== undefined && offre(id)) {
          poser(id, { phase: 'compte_en_creation' });
          planifier(id, delai, () => {
            if (offre(id)) void lancer(id, 'valider', undefined, { ...rejeux, compte: rejeux.compte + 1 });
            else poser(id);
          });
          return;
        }
      }
      poser(id, { phase: 'erreur', action, error });
      void rafraichir(); // l'état réel (validée ou refusée ailleurs, reprise partielle) s'affiche
      return;
    }

    if (res.kind === 'en_cours' && res.data.code === 'licence_en_cours' && action === 'valider') {
      // Pas une erreur : Entra attribue la licence. Le compte reste dans le groupe, la revalidation la retrouve.
      if (rejeux.licence >= REVALIDATIONS_LICENCE_MAX || !offre(id)) {
        poser(id, rejeux.licence >= REVALIDATIONS_LICENCE_MAX ? { phase: 'licence_lente' } : undefined);
        return;
      }
      poser(id, { phase: 'licence_en_cours' });
      planifier(id, REVALIDATION_LICENCE_MS, () => {
        if (offre(id)) void lancer(id, 'valider', undefined, { ...rejeux, licence: rejeux.licence + 1 });
        else poser(id);
      });
      return;
    }

    // Succès : la ligne reste verrouillée jusqu'à ce que la liste (l'état réel) soit relue.
    poser(id, { phase: 'en_cours', action });
    void rafraichir().finally(() => poser(id));
  };

  const demarrer = (id: string, action: ActionNom, motif?: string): Promise<void> => {
    if (verrouille(etats[id])) return Promise.resolve();
    poser(id, { phase: 'en_cours', action });
    return lancer(id, action, motif, { compte: 0, licence: 0 });
  };

  return {
    etats,
    valider: (id: string) => void demarrer(id, 'valider'),
    /** Rend la main quand le serveur a répondu (la boîte de dialogue se ferme alors ; l'erreur éventuelle est dans la ligne). */
    refuser: (id: string, motif: string) => demarrer(id, 'refuser', motif),
    /** Ferme l'erreur ou l'avertissement d'une ligne. */
    fermer: (id: string) => poser(id),
  };
}

export type ActionsDemandes = ReturnType<typeof useActionsDemandes>;
