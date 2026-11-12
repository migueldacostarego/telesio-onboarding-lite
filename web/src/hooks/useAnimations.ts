import { useEffect, useState } from 'react';

/** Décalage entre deux lignes et durée d'apparition d'une ligne (index.css, `animate-ligne`). */
export const PAS_LIGNES_MS = 30;
const DUREE_LIGNE_MS = 250;
/** Au-delà, les lignes apparaissent ensemble : la liste ne met jamais plus de ~0,5 s à se poser. */
const LIGNES_DECALEES = 10;

let listeDejaAnimee = false;

/** Retard d'apparition de la ligne n, borné. */
export function retardLigne(index: number): number {
  return Math.min(index, LIGNES_DECALEES) * PAS_LIGNES_MS;
}

/**
 * Vrai pendant le tout premier affichage de la liste dans l'onglet, le temps que les lignes apparaissent l'une après l'autre ; faux
 * ensuite (actualisation, filtre, retour depuis le détail) : les lignes ne rejouent pas leur entrée.
 */
export function useApparitionInitiale(nombre: number): boolean {
  const [animer, setAnimer] = useState(() => !listeDejaAnimee);
  useEffect(() => {
    if (!animer || nombre === 0) return;
    listeDejaAnimee = true;
    const minuteur = setTimeout(() => setAnimer(false), retardLigne(nombre) + DUREE_LIGNE_MS);
    return () => clearTimeout(minuteur);
  }, [animer, nombre]);
  return animer;
}

/**
 * Vrai à partir du rendu où `valeur` passe de faux à vrai (une étape franchie), faux si elle était déjà vraie au montage : la
 * pulsation ne se joue que sur un vrai changement, pas à l'ouverture de la page. La classe reste posée ensuite ; une animation CSS ne
 * se joue qu'une fois, quand la classe apparaît.
 */
export function useDevientVrai(valeur: boolean): boolean {
  const [precedente, setPrecedente] = useState(valeur);
  const [devenue, setDevenue] = useState(false);
  if (valeur !== precedente) {
    setPrecedente(valeur);
    setDevenue(valeur);
  }
  return devenue;
}

/** Pour les tests : rejouer l'apparition initiale. */
export function reinitialiserApparition(): void {
  listeDejaAnimee = false;
}
