import type { ReactNode } from 'react';
import { Initiales } from '@/components/demandes/Initiales';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { TypeBadge } from '@/components/demandes/TypeBadge';
import { arriveeRelative, jourAParis } from '@/lib/dates';
import type { DemandeDetail } from '@/lib/detail';
import { intitulePoste } from '@/lib/detailDemande';
import { formatArrivee, type Statut } from '@/lib/suivi';

function SousTitre({ d }: { d: DemandeDetail }) {
  const relative = arriveeRelative(d.dateArrivee, jourAParis());
  return (
    <p className="text-sm text-muted-foreground">
      {intitulePoste(d)}
      {d.dateArrivee && <> · arrivée le {formatArrivee(d.dateArrivee)}{relative && ` (${relative.toLowerCase()})`}</>}
    </p>
  );
}

/** En-tête de la page de détail : identité, statut, poste et arrivée ; `children` : les boutons d'action, s'il y en a (rien sinon). */
export function EnTeteDetail({ d, statut, children }: { d: DemandeDetail; statut: Statut; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <Initiales id={d.id} nom={d.nom} taille="lg" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{d.nom}</h1>
            <StatutBadge statut={statut} />
            <TypeBadge type={d.typeContrat} />
          </div>
          <SousTitre d={d} />
        </div>
      </div>
      {children && <div className="space-y-2">{children}</div>}
    </header>
  );
}
