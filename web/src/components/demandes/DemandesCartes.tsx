import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionsCompactes } from '@/components/demandes/ActionsCompactes';
import { MessageLigne } from '@/components/demandes/ActionsLigne';
import { Adresse } from '@/components/demandes/Adresse';
import { EtatLigne } from '@/components/demandes/EtatLigne';
import { Initiales } from '@/components/demandes/Initiales';
import { actionsDe, ouvrirSiLigne, type PropsLignes } from '@/components/demandes/lignes';
import { Progression } from '@/components/demandes/Progression';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { TypeBadge } from '@/components/demandes/TypeBadge';
import { arriveeRelative } from '@/lib/dates';
import { formatArrivee } from '@/lib/suivi';

/** Mobile : une carte compacte par demande, avec l'action principale et le menu « … ». */
export function DemandesCartes({ aujourdhui, ...lignes }: PropsLignes & { aujourdhui: string }) {
  const { demandes } = lignes;
  return (
    <ul aria-label="Demandes d’onboarding en cours" className="space-y-2">
      {demandes.map((d) => {
        const poste = [d.poste, d.service].filter(Boolean).join(' · ');
        const relative = arriveeRelative(d.dateArrivee, aujourdhui);
        return (
          <li
            key={d.id}
            id={`demande-${d.id}`}
            data-nouvelle={lignes.surlignee === d.id || undefined}
            className={`cursor-pointer space-y-2 rounded-lg border p-3 text-card-foreground ${lignes.surlignee === d.id ? 'border-ring bg-accent ring-2 ring-ring/40' : 'bg-card'}`}
            onClick={(e) => ouvrirSiLigne(e, () => lignes.onOuvrir(d))}
          >
            <div className="flex items-start gap-3">
              <Initiales id={d.id} nom={d.nom} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium break-words">
                  <Link
                    to={`/demandes/${d.id}`}
                    aria-label={`Voir le détail de la demande de ${d.nom}`}
                    className="rounded-sm text-left font-medium break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {d.nom}
                  </Link>
                  <TypeBadge type={d.typeContrat} />
                  {lignes.surlignee === d.id && <span className="sr-only"> (nouvelle demande)</span>}
                </p>
                <Adresse upn={d.upn} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{poste || 'Poste non renseigné'}</p>
            <p className="text-sm">
              Arrivée : {formatArrivee(d.dateArrivee)}
              {relative && <span className="text-muted-foreground"> ({relative.toLowerCase()})</span>}
            </p>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatutBadge statut={d.statut} />
                  <Progression etape={d.etape} />
                </div>
                <EtatLigne demande={d} etat={lignes.etats[d.id]} aujourdhui={aujourdhui} />
              </div>
              <ActionsCompactes {...actionsDe(d, lignes)} />
            </div>
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
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full bg-foreground/10" />
            <Skeleton className="h-5 w-40 bg-foreground/10" />
          </div>
          <Skeleton className="h-4 w-44 bg-foreground/10" />
          <Skeleton className="h-6 w-24 rounded-full bg-foreground/10" />
          <Skeleton className="h-8 w-full bg-foreground/10" />
        </li>
      ))}
    </ul>
  );
}
