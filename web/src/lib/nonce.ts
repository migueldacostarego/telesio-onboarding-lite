import { setNonce } from 'get-nonce';

/** Marqueur que web/index.html garde tel quel hors d'Express (vite dev) : ce n'est pas un nonce. */
const PLACEHOLDER = '__CSP_NONCE__';

/**
 * Nonce de la CSP, posé par Express dans la meta `csp-nonce` de index.html à chaque requête (style-src 'self' 'nonce-…').
 * Les composants modaux de Radix (dialog, sheet, menu modal) créent un <style> à l'exécution pour verrouiller le défilement,
 * via react-style-singleton, qui lit ce nonce avec get-nonce : sans lui la CSP bloquerait la feuille. À appeler avant le rendu.
 * Renvoie le nonce posé, ou undefined (meta absente, vide ou non remplacée : pas de CSP à nonce, rien à faire).
 */
export function appliquerNonce(doc: Document = document): string | undefined {
  const nonce = doc.querySelector('meta[name="csp-nonce"]')?.getAttribute('content')?.trim();
  if (!nonce || nonce === PLACEHOLDER) return undefined;
  setNonce(nonce);
  return nonce;
}
