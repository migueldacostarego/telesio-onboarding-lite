import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import {
  REESSAIS_COMPTE_MS,
  REVALIDATION_LICENCE_MS,
  REVALIDATIONS_LICENCE_MAX,
  cheminAction,
  corpsAction,
  estCompteIntrouvable,
  verrouille,
  type ActionNom,
  type EtatLigne,
  type Remise,
} from '@/lib/actions';
import { isSessionExpiredError } from '@/lib/session';
import { SUIVI_KEY, type Demande } from '@/lib/suivi';
import { attendre } from '@/lib/synchro';

type Etats = Record<string, EtatLigne>;
interface Appel {
  id: string;
  action: ActionNom;
  /** Texte de refus, ou code de régénération. */
  motif?: string;
}
const ecrire = ({ id, action, motif }: Appel) => api.post<Record<string, unknown>>(cheminAction(id, action), corpsAction(action, motif));
/** Combien de fois on a déjà rejoué pour chaque cause (compte pas encore répliqué, licence en cours). */
interface Rejeux {
  compte: number;
  licence: number;
}

/**
 * La ligne après une action réussie, quand elle change de statut : valider (Validé) et activer (Actif). Les actions à venir sont
 * inconnues du client (le jour J, le dossier SharePoint) : aucune, jusqu'à la lecture suivante de l'API. Refuser retire la ligne
 * comme avant ; régénérer et reprendre ne changent pas de statut (la ligne est déjà là, l'API la renvoie).
 */
function statutApres(d: Demande, action: ActionNom): Demande | undefined {
  if (action === 'valider') return { ...d, statut: 'Validé', etape: 2, actions: [], onboarding: undefined };
  if (action === 'activer') return { ...d, statut: 'Actif', etape: 3, actions: [], onboarding: { motDePasse: false, authenticator: false, termine: false } };
  return undefined;
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
export function useActionsDemandes(demandes: readonly Demande[] | undefined, { onRemise }: { onRemise?: (remise: Remise) => void } = {}) {
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
  const { mutateAsync } = useMutation({ mutationFn: ecrire });
  // Activer et régénérer renvoient le mot de passe temporaire : la mutation n'a aucun observateur (`useMutation` garderait la
  // dernière réponse dans son résultat) et sort du cache dès qu'elle se termine (`remove`), sans attendre un délai. `gcTime:
  // Infinity` pendant l'attente : avec 0, TanStack réarmerait un minuteur de 0 ms en boucle tant que la requête est en cours.
  const executerSensible = async (appel: Appel) => {
    const cache = queryClient.getMutationCache();
    const mutation = cache.build(queryClient, { mutationFn: ecrire, gcTime: Infinity });
    try {
      return await mutation.execute(appel);
    } finally {
      cache.remove(mutation);
    }
  };
  const surRemise = useRef(onRemise);
  useEffect(() => {
    surRemise.current = onRemise;
  }, [onRemise]);

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
      const appel = { id, action, motif };
      res = action === 'activer' || action === 'regenerer' ? await executerSensible(appel) : await mutateAsync(appel);
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

    if (action === 'activer' || action === 'regenerer') {
      // Le mot de passe va au seul appelant (état de la boîte de dialogue) : ni cache, ni stockage, ni journal.
      const motDePasse = res.kind === 'ok' ? res.data.motDePasseTemporaire : undefined;
      if (typeof motDePasse !== 'string' || motDePasse === '') {
        poser(id, { phase: 'erreur', action, error: new ApiError({ status: res.status, kind: 'serveur', message: 'Réponse inattendue du serveur : aucun mot de passe temporaire reçu.' }) });
        void rafraichir();
        return;
      }
      surRemise.current?.({ id, motDePasse, regeneration: action === 'regenerer' });
    }

    // Succès : la ligne prend tout de suite son nouveau statut dans le cache (et le garde tant que la réplication d'Entra ne l'a pas
    // rendu, 3 minutes au plus : lib/synchro.ts), puis reste verrouillée jusqu'à ce que la liste (l'état réel) soit relue.
    const avant = courantes.current?.find((d) => d.id === id);
    const apres = avant && statutApres(avant, action);
    if (apres) attendre(queryClient, apres);
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
    /** Ces trois-là rendent la main quand le serveur a répondu (la boîte de dialogue se ferme alors ; l'erreur éventuelle est dans la ligne). */
    refuser: (id: string, motif: string) => demarrer(id, 'refuser', motif),
    /** Valider et reprendre partent d'un clic, sans boîte de dialogue ; reprendre recrée le dossier SharePoint manquant d'un compte Validé. */
    reprendre: (id: string) => void demarrer(id, 'reprendre'),
    activer: (id: string) => demarrer(id, 'activer'),
    regenerer: (id: string, motif: string) => demarrer(id, 'regenerer', motif),
    /** Ferme l'erreur ou l'avertissement d'une ligne. */
    fermer: (id: string) => poser(id),
  };
}

export type ActionsDemandes = ReturnType<typeof useActionsDemandes>;
