import { useEffect, useState } from 'react';

/** `valeur` après `ms` sans changement (le terme de recherche du manager part 300 ms après la dernière frappe). */
export function useDebounced<T>(valeur: T, ms: number): T {
  const [retardee, setRetardee] = useState(valeur);
  useEffect(() => {
    const id = setTimeout(() => setRetardee(valeur), ms);
    return () => clearTimeout(id);
  }, [valeur, ms]);
  return retardee;
}
