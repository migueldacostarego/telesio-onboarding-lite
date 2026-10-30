import { Fragment } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ActionsLigne, MessageLigne } from '@/components/demandes/ActionsLigne';
import { Adresse } from '@/components/demandes/Adresse';
import { Progression } from '@/components/demandes/Progression';
import { StatutBadge, Synchronisation } from '@/components/demandes/StatutBadge';
import { actionsDe, aUnMessage, ouvrirSiLigne, type PropsLignes } from '@/components/demandes/lignes';
import { formatArrivee, type Tri } from '@/lib/suivi';

const COLONNES = 7;

const ABSENT = <span className="text-muted-foreground">Non renseigné</span>;

/**
 * Mise en page stable : `table-layout: fixed`, largeurs de colonnes posées sur l'en-tête (la colonne Nom prend le reste), texte
 * tronqué avec infobulle, hauteur de ligne constante. Rien dans une cellule (synchronisation, boutons, filtre) ne fait bouger les
 * colonnes ni la hauteur d'une ligne. Les largeurs tiennent dans les 990 px du contenu (max-w-5xl) ; plus étroit, le tableau défile
 * dans son cadre. La colonne Actions loge deux boutons côte à côte (jamais plus), la colonne Statut « synchronisation… ».
 */
const TABLE = 'min-w-[60rem] table-fixed';
const LIGNE = 'h-[4.5rem]';
const LARGEUR = { poste: 'w-30', service: 'w-25', arrivee: 'w-28', statut: 'w-32', progression: 'w-28', actions: 'w-56' } as const;

function Entete({ tri }: { tri: Tri }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Nom</TableHead>
        <TableHead className={LARGEUR.poste}>Poste</TableHead>
        <TableHead className={LARGEUR.service}>Service</TableHead>
        <TableHead className={LARGEUR.arrivee} aria-sort={tri === 'recentes' ? 'descending' : tri === 'anciennes' ? 'ascending' : 'other'}>
          Arrivée
        </TableHead>
        <TableHead className={LARGEUR.statut}>Statut</TableHead>
        <TableHead className={LARGEUR.progression}>Progression</TableHead>
        <TableHead className={LARGEUR.actions}>Actions</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** Texte d'une cellule : une ligne, tronqué, l'infobulle donne la valeur entière. */
const Tronque = ({ valeur }: { valeur: string | null }) => (valeur ? <span title={valeur}>{valeur}</span> : ABSENT);

/** Bureau : tableau, avec les actions que l'API propose. Sur mobile, DemandesCartes prend le relais. */
export function DemandesTable({ tri, ...lignes }: PropsLignes & { tri: Tri }) {
  const { demandes } = lignes;
  return (
    <div className="rounded-lg border">
      <Table className={TABLE}>
        <caption className="sr-only">Demandes d’onboarding en cours</caption>
        <Entete tri={tri} />
        <TableBody>
          {demandes.map((d) => (
            <Fragment key={d.id}>
              <TableRow
                id={`demande-${d.id}`}
                data-nouvelle={lignes.surlignee === d.id || undefined}
                className={`${LIGNE} cursor-pointer ${lignes.surlignee === d.id ? 'bg-accent shadow-[inset_3px_0_0_0_var(--color-ring)]' : ''}`}
                onClick={(e) => ouvrirSiLigne(e, () => lignes.onOuvrir(d))}
              >
                <TableCell className="overflow-hidden font-medium">
                  {/* Le nom est un vrai lien (clavier, lecteur d'écran, ouvrir dans un nouvel onglet) ; la ligne entière est cliquable à la souris. */}
                  <Link
                    to={`/demandes/${d.id}`}
                    aria-label={`Voir le détail de la demande de ${d.nom}`}
                    title={d.nom}
                    className="block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {d.nom}
                  </Link>
                  <Adresse upn={d.upn} />
                  {lignes.surlignee === d.id && <span className="sr-only"> (nouvelle demande)</span>}
                </TableCell>
                <TableCell className="truncate">
                  <Tronque valeur={d.poste} />
                </TableCell>
                <TableCell className="truncate">
                  <Tronque valeur={d.service} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatArrivee(d.dateArrivee)}</TableCell>
                <TableCell>
                  <StatutBadge statut={d.statut} />
                  <Synchronisation synchro={d.synchro} />
                </TableCell>
                <TableCell>
                  <Progression etape={d.etape} barre="w-12" />
                </TableCell>
                <TableCell>
                  <ActionsLigne {...actionsDe(d, lignes)} surUneLigne />
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
      <Table className={TABLE}>
        <caption className="sr-only">Chargement des demandes</caption>
        <Entete tri={tri} />
        <TableBody>
          {Array.from({ length: 5 }, (_, i) => (
            <TableRow key={i} className={LIGNE}>
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
