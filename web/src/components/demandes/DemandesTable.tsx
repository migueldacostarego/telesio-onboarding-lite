import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progression } from '@/components/demandes/Progression';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { formatArrivee, type Demande, type Tri } from '@/lib/suivi';

const ABSENT = <span className="text-muted-foreground">Non renseigné</span>;

function Entete({ tri }: { tri: Tri }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Nom</TableHead>
        <TableHead>Poste</TableHead>
        <TableHead>Service</TableHead>
        <TableHead aria-sort={tri === 'recentes' ? 'descending' : tri === 'anciennes' ? 'ascending' : 'other'}>Arrivée</TableHead>
        <TableHead>Statut</TableHead>
        <TableHead>Progression</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** Bureau : tableau (lecture seule). Sur mobile, DemandesCartes prend le relais. */
export function DemandesTable({ demandes, tri }: { demandes: readonly Demande[]; tri: Tri }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <caption className="sr-only">Demandes d’onboarding en cours</caption>
        <Entete tri={tri} />
        <TableBody>
          {demandes.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.nom}</TableCell>
              <TableCell>{d.poste ?? ABSENT}</TableCell>
              <TableCell>{d.service ?? ABSENT}</TableCell>
              <TableCell className="whitespace-nowrap">{formatArrivee(d.dateArrivee)}</TableCell>
              <TableCell>
                <StatutBadge statut={d.statut} />
              </TableCell>
              <TableCell>
                <Progression etape={d.etape} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Squelette du tableau : mêmes colonnes et même hauteur de ligne que les données. */
export function DemandesTableSquelette({ tri }: { tri: Tri }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <caption className="sr-only">Chargement des demandes</caption>
        <Entete tri={tri} />
        <TableBody>
          {Array.from({ length: 5 }, (_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-36 bg-foreground/10" /></TableCell>
              <TableCell><Skeleton className="h-5 w-28 bg-foreground/10" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24 bg-foreground/10" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24 bg-foreground/10" /></TableCell>
              <TableCell><Skeleton className="h-5 w-20 rounded-full bg-foreground/10" /></TableCell>
              <TableCell><Skeleton className="h-5 w-28 bg-foreground/10" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
