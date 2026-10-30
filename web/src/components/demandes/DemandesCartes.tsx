import { Skeleton } from '@/components/ui/skeleton';
import { ActionsLigne, MessageLigne } from '@/components/demandes/ActionsLigne';
import { actionsDe, occupee, ouvrirSiLigne, type PropsLignes } from '@/components/demandes/lignes';
import { Progression } from '@/components/demandes/Progression';
import { StatutBadge, Synchronisation } from '@/components/demandes/StatutBadge';
import { formatArrivee } from '@/lib/suivi';

/** Mobile : une carte compacte par demande, avec les actions que l'API propose. */
export function DemandesCartes(lignes: PropsLignes) {
  const { demandes } = lignes;
  return (
    <ul aria-label="Demandes d’onboarding en cours" className="space-y-2">
      {demandes.map((d) => {
        const poste = [d.poste, d.service].filter(Boolean).join(' · ');
        return (
          <li
            key={d.id}
            id={`demande-${d.id}`}
            data-nouvelle={lignes.surlignee === d.id || undefined}
            className={`space-y-1.5 rounded-lg border p-3 text-card-foreground ${occupee(lignes, d) ? '' : 'cursor-pointer'} ${lignes.surlignee === d.id ? 'border-ring bg-accent ring-2 ring-ring/40' : 'bg-card'}`}
            onClick={occupee(lignes, d) ? undefined : (e) => ouvrirSiLigne(e, () => lignes.onOuvrir(d))}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-medium break-words">
                <button
                  type="button"
                  disabled={occupee(lignes, d)}
                  aria-label={`Voir le détail de la demande de ${d.nom}`}
                  onClick={() => lignes.onOuvrir(d)}
                  className="rounded-sm text-left font-medium break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {d.nom}
                </button>
                {lignes.surlignee === d.id && <span className="sr-only"> (nouvelle demande)</span>}
              </p>
              <StatutBadge statut={d.statut} />
            </div>
            <Synchronisation synchro={d.synchro} />
            <p className="text-sm text-muted-foreground">{poste || 'Poste non renseigné'}</p>
            <p className="text-sm">Arrivée : {formatArrivee(d.dateArrivee)}</p>
            <Progression etape={d.etape} />
            <ActionsLigne {...actionsDe(d, lignes)} />
            <MessageLigne etat={lignes.etats[d.id]} onFermer={() => lignes.onFermer(d)} />
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
