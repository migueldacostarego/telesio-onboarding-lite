import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError, type ApiErrorKind } from '@/lib/api';

const TITRES: Record<ApiErrorKind, string> = {
  reseau: 'Réseau indisponible',
  session: 'Session expirée',
  invalide: 'Saisie invalide',
  non_autorise: 'Accès refusé',
  introuvable: 'Introuvable',
  conflit: 'Action impossible dans l’état actuel',
  amont: 'Une étape a échoué',
  indisponible: 'Fonction indisponible',
  serveur: 'Erreur du serveur',
};

/**
 * Message d'erreur affiché dans l'écran ou la ligne concernés (pas de toast : la CSP interdit
 * les feuilles de style injectées à l'exécution). Le texte vient du back, jamais d'une donnée Entra.
 */
export function ApiErrorAlert({ error, className }: { error: unknown; className?: string }) {
  const api = error instanceof ApiError ? error : undefined;
  const details = Object.entries(api?.details ?? {});
  return (
    <Alert variant="destructive" className={className}>
      <AlertTitle>{api ? TITRES[api.kind] : 'Erreur inattendue'}</AlertTitle>
      <AlertDescription>
        <p>{api?.message ?? 'Une erreur est survenue : rechargez la page.'}</p>
        {details.length > 0 && (
          <ul>
            {details.map(([champ, message]) => (
              <li key={champ}>
                {champ} : {message}
              </li>
            ))}
          </ul>
        )}
        {api?.etape && <p>Étape : {api.etape}</p>}
      </AlertDescription>
    </Alert>
  );
}
