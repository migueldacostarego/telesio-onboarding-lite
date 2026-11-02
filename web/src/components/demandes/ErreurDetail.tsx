import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

function Introuvable() {
  return (
    <div className="max-w-lg space-y-3 rounded-lg border border-dashed p-8">
      <h1 className="text-lg font-semibold">Demande introuvable</h1>
      <p className="text-sm text-muted-foreground">Cette demande n’existe pas ou plus : elle a peut-être été refusée. Une demande refusée est supprimée.</p>
    </div>
  );
}

/** La page n'a rien à montrer : 404 (demande refusée ou lien ancien) dit « introuvable » ; toute autre erreur, son message et « Réessayer ». */
export function ErreurDetail({ error, enCours, onReessayer }: { error: unknown; enCours: boolean; onReessayer: () => void }) {
  if (error instanceof ApiError && error.status === 404) return <Introuvable />;
  return (
    <div className="max-w-lg space-y-3">
      <ApiErrorAlert error={error} />
      <Button variant="outline" onClick={onReessayer} disabled={enCours}>
        Réessayer
      </Button>
    </div>
  );
}
