import { Skeleton } from '@/components/ui/skeleton';
import { Progression } from '@/components/demandes/Progression';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { formatArrivee, type Demande } from '@/lib/suivi';

/** Mobile : une carte compacte par demande (lecture seule). */
export function DemandesCartes({ demandes }: { demandes: readonly Demande[] }) {
  return (
    <ul aria-label="Demandes d’onboarding en cours" className="space-y-2">
      {demandes.map((d) => {
        const poste = [d.poste, d.service].filter(Boolean).join(' · ');
        return (
          <li key={d.id} className="space-y-1.5 rounded-lg border bg-card p-3 text-card-foreground">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-medium break-words">{d.nom}</p>
              <StatutBadge statut={d.statut} />
            </div>
            <p className="text-sm text-muted-foreground">{poste || 'Poste non renseigné'}</p>
            <p className="text-sm">Arrivée : {formatArrivee(d.dateArrivee)}</p>
            <Progression etape={d.etape} />
          </li>
        );
      })}
    </ul>
  );
}

export function DemandesCartesSquelette() {
  return (
    <ul aria-hidden="true" className="space-y-2">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-40 bg-foreground/10" />
            <Skeleton className="h-5 w-16 rounded-full bg-foreground/10" />
          </div>
          <Skeleton className="h-4 w-44 bg-foreground/10" />
          <Skeleton className="h-4 w-32 bg-foreground/10" />
          <Skeleton className="h-4 w-28 bg-foreground/10" />
        </li>
      ))}
    </ul>
  );
}
