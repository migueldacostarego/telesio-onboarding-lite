import { Chronologie } from '@/components/demandes/Chronologie';
import type { Jalon } from '@/lib/chronologie';

/** Section « Historique » : la chronologie, et un bandeau tant que les extensions d'historique ne sont pas enregistrées sur l'environnement. */
export function HistoriqueDetail({ jalons, enregistre }: { jalons: readonly Jalon[]; enregistre: boolean }) {
  return (
    <section aria-labelledby="historique-titre" className="space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h2 id="historique-titre" className="text-base font-semibold">
          Historique
        </h2>
        <p className="text-sm text-muted-foreground">Heures de Paris.</p>
      </div>
      {!enregistre && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">L’historique (qui a validé, activé ou terminé, et quand) n’est pas encore enregistré sur cet environnement : seule la création est connue.</p>
      )}
      <Chronologie jalons={jalons} />
    </section>
  );
}
