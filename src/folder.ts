export const FOLDER_PLACEHOLDERS = ['nom', 'prenom', 'id'] as const;
export const DEFAULT_FOLDER_PATTERN = '{nom} {prenom}';

/** Retourne un message d'erreur, ou undefined si le motif est valide. */
export function checkFolderPattern(pattern: string): string | undefined {
  if (pattern.length > 100) return '100 caractères max';
  const found = [...pattern.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] as string);
  if (found.length === 0) return 'au moins un champ requis ({nom}, {prenom}, {id})';
  const bad = found.find((f) => !(FOLDER_PLACEHOLDERS as readonly string[]).includes(f));
  if (bad !== undefined) return `champ inconnu {${bad}} (attendu : {nom}, {prenom}, {id})`;
  if (/[{}]/.test(pattern.replace(/\{[^{}]*\}/g, ''))) return 'accolades non appariées';
  return undefined;
}

// Caractères interdits par SharePoint/OneDrive dans un nom de dossier.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_RE = /["*:<>?/\\|\u0000-\u001f\u007f]/g;

export function buildFolderName(pattern: string, vars: Record<'nom' | 'prenom' | 'id', string>): string {
  const name = pattern
    .replace(/\{(nom|prenom|id)\}/g, (_m, k: 'nom' | 'prenom' | 'id') => vars[k])
    .replace(FORBIDDEN_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120)
    .trim();
  if (!name) throw new Error('Nom de dossier vide après nettoyage');
  return name;
}
