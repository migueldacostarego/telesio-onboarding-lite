import { Fragment } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ActionsCompactes } from '@/components/demandes/ActionsCompactes';
import { MessageLigne } from '@/components/demandes/ActionsLigne';
import { Adresse } from '@/components/demandes/Adresse';
import { EtatLigne } from '@/components/demandes/EtatLigne';
import { Initiales } from '@/components/demandes/Initiales';
import { Progression } from '@/components/demandes/Progression';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { actionsDe, aUnMessage, ouvrirSiLigne, type PropsLignes } from '@/components/demandes/lignes';
import { arriveeRelative } from '@/lib/dates';
import { formatArrivee, type Tri } from '@/lib/suivi';

const COLONNES = 5;

const ABSENT = <span className="text-muted-foreground">Non renseigné</span>;

/**
 * Mise en page stable : `table-layout: fixed`, largeurs de colonnes posées sur l'en-tête (la colonne Personne prend le reste), texte
 * tronqué avec infobulle, hauteur de ligne constante. Rien dans une cellule (synchronisation, spinner, menu, filtre) ne fait bouger
 * les colonnes ni la hauteur d'une ligne. Les largeurs tiennent dans les 990 px du contenu (max-w-5xl) ; plus étroit, le tableau
 * défile dans son cadre.
 */
const TABLE = 'min-w-[60rem] table-fixed';
const LIGNE = 'h-[4.5rem]';
const LARGEUR = { poste: 'w-40', arrivee: 'w-32', statut: 'w-64', actions: 'w-44' } as const;

function Entete({ tri }: { tri: Tri }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Personne</TableHead>
        <TableHead className={LARGEUR.poste}>Poste</TableHead>
        <TableHead className={LARGEUR.arrivee} aria-sort={tri === 'recentes' ? 'descending' : tri === 'anciennes' ? 'ascending' : 'other'}>
          Arrivée
        </TableHead>
        <TableHead className={LARGEUR.statut}>Statut</TableHead>
        <TableHead className={`${LARGEUR.actions} text-right`}>Actions</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** Bureau : tableau, avec les actions que l'API propose. Sur mobile, DemandesCartes prend le relais. */
export function DemandesTable({ tri, aujourdhui, ...lignes }: PropsLignes & { tri: Tri; aujourdhui: string }) {
  const { demandes } = lignes;
  return (
    <div className="rounded-lg border">
      <Table className={TABLE}>
        <caption className="sr-only">Demandes d’onboarding en cours</caption>
        <Entete tri={tri} />
        <TableBody>
          {demandes.map((d) => {
            const relative = arriveeRelative(d.dateArrivee, aujourdhui);
            return (
              <Fragment key={d.id}>
                <TableRow
                  id={`demande-${d.id}`}
                  data-nouvelle={lignes.surlignee === d.id || undefined}
                  className={`${LIGNE} cursor-pointer ${lignes.surlignee === d.id ? 'bg-accent shadow-[inset_3px_0_0_0_var(--color-ring)]' : ''}`}
                  onClick={(e) => ouvrirSiLigne(e, () => lignes.onOuvrir(d))}
                >
                  <TableCell className="overflow-hidden">
                    <div className="flex min-w-0 items-center gap-3">
                      <Initiales id={d.id} nom={d.nom} />
                      <div className="min-w-0">
                        {/* Le nom est un vrai lien (clavier, lecteur d'écran, nouvel onglet) ; la ligne entière est cliquable à la souris. */}
                        <Link
                          to={`/demandes/${d.id}`}
                          aria-label={`Voir le détail de la demande de ${d.nom}`}
                          title={d.nom}
                          className="block max-w-full truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {d.nom}
                        </Link>
                        <Adresse upn={d.upn} />
                        {lignes.surlignee === d.id && <span className="sr-only"> (nouvelle demande)</span>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    {d.poste ? <span title={d.poste} className="block truncate">{d.poste}</span> : d.service ? null : ABSENT}
                    {d.service && <span title={d.service} className={`block truncate ${d.poste ? 'text-xs text-muted-foreground' : ''}`}>{d.service}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="block">{formatArrivee(d.dateArrivee)}</span>
                    {relative && <span className={`block text-xs ${relative === 'Aujourd’hui' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{relative}</span>}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <div className="flex items-center gap-2">
                      <StatutBadge statut={d.statut} />
                      <Progression etape={d.etape} />
                    </div>
                    <EtatLigne demande={d} etat={lignes.etats[d.id]} aujourdhui={aujourdhui} />
                  </TableCell>
                  <TableCell>
                    <ActionsCompactes {...actionsDe(d, lignes)} />
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
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Squelette du tableau : mêmes colonnes et même hauteur de ligne que les données. */
export function DemandesTableSquelette({ tri }: { tri: Tri }) {
  return (
    <div className="rounded-lg border">
      <Table className={TABLE}>
        <caption className="sr-only">Chargement des demandes</caption>
        <Entete tri={tri} />
        <TableBody>
          {Array.from({ length: 5 }, (_, i) => (
            <TableRow key={i} className={LIGNE}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-full bg-foreground/10" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32 bg-foreground/10" />
                    <Skeleton className="h-3 w-40 bg-foreground/10" />
                  </div>
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-4 w-24 bg-foreground/10" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20 bg-foreground/10" /></TableCell>
              <TableCell><Skeleton className="h-6 w-24 rounded-full bg-foreground/10" /></TableCell>
              <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-28 bg-foreground/10" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
