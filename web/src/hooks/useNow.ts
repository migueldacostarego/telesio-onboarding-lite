import { useEffect, useState } from 'react';

/** Instant courant, rafraîchi toutes les `intervalMs` (pour un affichage « il y a … » qui vieillit seul). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
