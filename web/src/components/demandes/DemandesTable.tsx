import { Fragment } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ActionsLigne, MessageLigne } from '@/components/demandes/ActionsLigne';
import { Progression } from '@/components/demandes/Progression';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { actionsDe, aUnMessage, type PropsLignes } from '@/components/demandes/lignes';
import { formatArrivee, type Tri } from '@/lib/suivi';

const COLONNES = 7;

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
        <TableHead>Actions</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** Bureau : tableau, avec les actions que l'API propose. Sur mobile, DemandesCartes prend le relais. */
export function DemandesTable({ tri, ...lignes }: PropsLignes & { tri: Tri }) {
  const { demandes } = lignes;
  return (
    <div className="rounded-lg border">
      <Table>
        <caption className="sr-only">Demandes d’onboarding en cours</caption>
        <Entete tri={tri} />
        <TableBody>
          {demandes.map((d) => (
            <Fragment key={d.id}>
              <TableRow id={`demande-${d.id}`} data-nouvelle={lignes.surlignee === d.id || undefined} className={lignes.surlignee === d.id ? 'bg-accent shadow-[inset_3px_0_0_0_var(--color-ring)]' : undefined}>
                <TableCell className="font-medium">
                  {d.nom}
                  {lignes.surlignee === d.id && <span className="sr-only"> (nouvelle demande)</span>}
                </TableCell>
                <TableCell>{d.poste ?? ABSENT}</TableCell>
                <TableCell>{d.service ?? ABSENT}</TableCell>
                <TableCell className="whitespace-nowrap">{formatArrivee(d.dateArrivee)}</TableCell>
                <TableCell>
                  <StatutBadge statut={d.statut} />
                </TableCell>
                <TableCell>
                  <Progression etape={d.etape} />
                </TableCell>
                <TableCell>
                  <ActionsLigne {...actionsDe(d, lignes)} />
                </TableCell>
              </TableRow>
              {aUnMessage(lignes, d) && (
                <TableRow>
                  <TableCell colSpan={COLONNES}>
                    <MessageLigne etat={lignes.etats[d.id]} onFermer={() => lignes.onFermer(d)} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
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
              <TableCell><Skeleton className="h-8 w-32 bg-foreground/10" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
