import type { QueryClient } from '@tanstack/react-query';
import { SUIVI_KEY, type Demande, type Suivi } from '@/lib/suivi';

/**
 * Entra met un moment à répliquer un compte : juste après une action réussie (créer, valider, activer), la recherche par statut
 * de `GET /api/suivi` renvoie encore l'ancien statut, ou ne renvoie pas du tout le compte. La ligne ne doit pas disparaître
 * ni revenir en arrière : l'écran écrit tout de suite la ligne avec son nouveau statut dans le cache, et la garde (`synchro:
 * true`) à chaque lecture suivante tant que l'API ne la rend pas à ce statut (ou un statut plus avancé), 3 minutes au plus.
 * Passé ce délai, l'API fait foi : la ligne disparaît si elle n'est toujours pas revenue.
 *
 * Un refus n'en fait pas partie : la ligne est retirée comme avant.
 */
export const DELAI_SYNCHRO_MS = 180_000;

interface Attente {
  /** La ligne telle qu'elle doit s'afficher (nouveau statut, étape, actions inconnues). */
  ligne: Demande;
  jusqua: number;
  minuteur: ReturnType<typeof setTimeout>;
}

// Une table par client de requêtes (un client par application, un par test) : aucun état partagé entre eux.
const attentes = new WeakMap<QueryClient, Map<string, Attente>>();
const tableDe = (client: QueryClient): Map<string, Attente> => {
  let table = attentes.get(client);
  if (!table) attentes.set(client, (table = new Map()));
  return table;
};

const oublier = (client: QueryClient, id: string) => {
  const table = tableDe(client);
  clearTimeout(table.get(id)?.minuteur);
  table.delete(id);
};

/**
 * Écrit la ligne dans le cache tout de suite et la garde jusqu'à ce que l'API la rende (ou 3 minutes). Sans liste en cache
 * (premier chargement pas fini), rien à mettre à jour : la lecture en cours verra la ligne par `fusionner`.
 */
export function attendre(client: QueryClient, ligne: Demande): void {
  const marquee: Demande = { ...ligne, synchro: true };
  oublier(client, ligne.id);
  tableDe(client).set(ligne.id, {
    ligne: marquee,
    jusqua: Date.now() + DELAI_SYNCHRO_MS,
    // À l'échéance : la ligne n'est plus gardée, la relecture rend à l'API le dernier mot.
    minuteur: setTimeout(() => {
      oublier(client, ligne.id);
      void client.invalidateQueries({ queryKey: SUIVI_KEY });
    }, DELAI_SYNCHRO_MS),
  });
  client.setQueryData<Suivi>(SUIVI_KEY, (suivi) => {
    if (!suivi) return suivi;
    const present = suivi.demandes.some((d) => d.id === ligne.id);
    return { ...suivi, demandes: present ? suivi.demandes.map((d) => (d.id === ligne.id ? marquee : d)) : [...suivi.demandes, marquee] };
  });
}

/**
 * Fusionne une lecture de l'API avec les lignes en attente. Une ligne rendue au statut attendu (ou plus avancé) redevient celle
 * de l'API ; rendue à un statut plus ancien, elle garde le statut attendu ; absente, elle est ajoutée telle quelle.
 */
export function fusionner(client: QueryClient, serveur: readonly Demande[]): Demande[] {
  const table = tableDe(client);
  if (table.size === 0) return [...serveur];
  const maintenant = Date.now();
  const demandes = [...serveur];
  for (const [id, a] of [...table]) {
    if (maintenant >= a.jusqua) {
      oublier(client, id);
      continue;
    }
    const i = demandes.findIndex((d) => d.id === id);
    if (i === -1) demandes.push(a.ligne);
    else if (demandes[i]!.etape >= a.ligne.etape) oublier(client, id);
    else demandes[i] = { ...demandes[i]!, statut: a.ligne.statut, etape: a.ligne.etape, actions: a.ligne.actions, onboarding: a.ligne.onboarding, synchro: true };
  }
  return demandes;
}

/** Au moins une ligne est gardée en attente de l'API : la liste est relue sans attendre l'actualisation de 30 s. */
export const enSynchro = (demandes: readonly Demande[] | undefined): boolean => demandes?.some((d) => d.synchro === true) === true;
