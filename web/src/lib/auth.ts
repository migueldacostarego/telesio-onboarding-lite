/**
 * Adresses Easy Auth (App Service) : fixes, jamais construites à partir d'une saisie ou d'un paramètre d'URL
 * (pas de redirection ouverte). Retour sur le front après la déconnexion.
 */
export const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/app/';
/** Une navigation vers le front, sans session, renvoie vers la connexion Microsoft (Easy Auth). */
export const LOGIN_URL = '/app/';

/** Initiales (2 au plus) du nom affiché, à défaut de la partie locale de l'email, à défaut « ? ». */
export function initials(nom: string, email?: string | null): string {
  const words = nom.trim().split(/[\s-]+/).filter(Boolean);
  const source = words.length > 0 ? words : (email?.split('@')[0] ?? '').split(/[._-]+/).filter(Boolean);
  const letters = (source.length > 1 ? [source[0], source[source.length - 1]] : source.slice(0, 1))
    .map((w) => Array.from(w ?? '')[0] ?? '')
    .join('');
  return letters.toLocaleUpperCase('fr') || '?';
}
