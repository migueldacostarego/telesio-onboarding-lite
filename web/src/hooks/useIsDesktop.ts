import { useSyncExternalStore } from 'react';

/** Même seuil que `md` de Tailwind : en dessous, chaque ligne devient une carte. */
const QUERY = '(min-width: 768px)';

const mql = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null);

function subscribe(onChange: () => void): () => void {
  const m = mql();
  m?.addEventListener('change', onChange);
  return () => m?.removeEventListener('change', onChange);
}

/** Vrai à partir de 768 px de large (et par défaut sans matchMedia). Un seul rendu à la fois : pas de contenu en double dans le DOM. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => mql()?.matches ?? true, () => true);
}
