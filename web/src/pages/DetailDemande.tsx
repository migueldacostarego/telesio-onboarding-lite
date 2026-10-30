import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { ActionsLigne, MessageLigne } from '@/components/demandes/ActionsLigne';
import { BoutonCopier } from '@/components/demandes/Adresse';
import { Chronologie } from '@/components/demandes/Chronologie';
import { Initiales } from '@/components/demandes/Initiales';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { chronologie } from '@/lib/chronologie';
import { useDemandes } from '@/lib/contexteDemandes';
import { jourAParis, arriveeRelative } from '@/lib/dates';
import { useDemande, type DemandeDetail } from '@/lib/detail';
import { formatArrivee, type Demande, type EtatOnboarding } from '@/lib/suivi';

const ABSENT = <span className="text-muted-foreground">Non renseigné</span>;

function Rubrique({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section aria-label={titre} className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{titre}</h2>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

const Ligne = ({ libelle, children }: { libelle: string; children: ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{libelle}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </>
);

const LIBELLES_LICENCE = { choisie: 'réservée à la validation', attribuee: 'attribuée', en_cours: 'attribution en cours', erreur: 'attribution en erreur', inconnu: 'état illisible' } as const;

function Licence({ d }: { d: DemandeDetail }) {
  if (!d.licence) return ABSENT;
  return (
    <>
      {d.licence.libelle ?? 'Licence retirée de la liste'} <span className="text-muted-foreground">: {LIBELLES_LICENCE[d.licence.etat]}</span>
    </>
  );
}

function Dossier({ d }: { d: DemandeDetail }) {
  if (d.statut === 'EnAttente') return <span className="text-muted-foreground">Créé à la validation</span>;
  if (!d.dossier) return <span className="text-muted-foreground">Indisponible</span>;
  if (d.dossier.etat === 'absent') return <span className="text-destructive">Non créé</span>;
  if (!d.dossier.url) return <>Créé</>;
  return (
    <a href={d.dossier.url} target="_blank" rel="noopener noreferrer" className="inline-flex flex-wrap items-center gap-x-1 rounded-sm font-medium underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      Ouvrir dans SharePoint
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );
}

function Groupe({ d }: { d: DemandeDetail }) {
  if (d.statut === 'EnAttente') return <span className="text-muted-foreground">Ajouté à la validation</span>;
  if (!d.groupeArrivants) return <span className="text-muted-foreground">Indisponible</span>;
  return <>{d.groupeArrivants.membre ? 'Membre' : 'Non membre'}</>;
}

function Chargement() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Chargement de la demande…</span>
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-full bg-foreground/10" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56 bg-foreground/10" />
          <Skeleton className="h-4 w-72 bg-foreground/10" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-80 bg-foreground/10" />
        <Skeleton className="h-80 bg-foreground/10" />
      </div>
    </div>
  );
}

const Retour = () => (
  <Button asChild variant="ghost" size="sm" className="-ml-2">
    <Link to="/">
      <ArrowLeftIcon aria-hidden="true" />
      Toutes les demandes
    </Link>
  </Button>
);

/**
 * Page d'une demande : `/demandes/:id` (l'objectId est la seule donnée de l'adresse). Identité, licence, groupe des arrivants,
 * dossier SharePoint et chronologie complète, d'après `GET /api/demandes/:id`. Les boutons d'action et leur état sont ceux de la
 * liste (contexte partagé) : ils viennent de `GET /api/suivi`, comme la ligne de synchronisation d'Entra (lib/synchro.ts).
 */
export function DetailDemande() {
  const { id = '' } = useParams();
  const { suivi, actions, surAction } = useDemandes();
  const ligne: Demande | undefined = suivi.data?.demandes.find((d) => d.id === id);
  const requete = useDemande(id, { attendue: ligne !== undefined, synchro: ligne?.synchro === true });
  const d = requete.data;

  let corps: ReactNode;
  if (requete.isPending) corps = <Chargement />;
  else if (!d) {
    const introuvable = requete.error instanceof ApiError && requete.error.status === 404;
    corps = introuvable ? (
      <div className="max-w-lg space-y-3 rounded-lg border border-dashed p-8">
        <h1 className="text-lg font-semibold">Demande introuvable</h1>
        <p className="text-sm text-muted-foreground">Cette demande n’existe pas ou plus : elle a peut-être été refusée. Une demande refusée est supprimée.</p>
      </div>
    ) : (
      <div className="max-w-lg space-y-3">
        <ApiErrorAlert error={requete.error} />
        <Button variant="outline" onClick={() => void requete.refetch()} disabled={requete.isFetching}>
          Réessayer
        </Button>
      </div>
    );
  } else {
    // La liste peut être plus avancée que le détail juste après une action (réplication d'Entra) : elle fait foi pour l'étape.
    const etape = Math.max(d.etape, ligne?.etape ?? 0);
    const statut = ligne && ligne.etape > d.etape ? ligne.statut : d.statut;
    const onboarding: EtatOnboarding | undefined = ligne?.synchro ? ligne.onboarding : (d.onboarding ?? ligne?.onboarding);
    const jalons = chronologie({ detail: d, etape, onboarding, actions: ligne?.actions ?? d.actions, etat: actions.etats[d.id] });
    const relative = arriveeRelative(d.dateArrivee, jourAParis());
    const poste = [d.poste, d.service].filter(Boolean).join(' · ');
    corps = (
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Initiales id={d.id} nom={d.nom} taille="lg" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-semibold tracking-tight break-words">{d.nom}</h1>
                <StatutBadge statut={statut} />
              </div>
              <p className="text-sm text-muted-foreground">
                {poste || 'Poste non renseigné'}
                {d.dateArrivee && <> · arrivée le {formatArrivee(d.dateArrivee)}{relative && ` (${relative.toLowerCase()})`}</>}
              </p>
            </div>
          </div>
          {ligne && (
            <div className="space-y-2">
              <ActionsLigne demande={ligne} etat={actions.etats[d.id]} onAction={(action) => surAction(ligne, action)} />
            </div>
          )}
        </header>
        {ligne && <MessageLigne etat={actions.etats[d.id]} onFermer={() => actions.fermer(d.id)} />}
        {requete.isError && <ApiErrorAlert error={requete.error} />}

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
          <section aria-labelledby="historique-titre" className="space-y-4 rounded-lg border bg-card p-5">
            <div className="space-y-1">
              <h2 id="historique-titre" className="text-base font-semibold">
                Historique
              </h2>
              <p className="text-sm text-muted-foreground">Heures de Paris.</p>
            </div>
            {!d.historique.enregistre && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">L’historique (qui a validé, activé ou terminé, et quand) n’est pas encore enregistré sur cet environnement : seule la création est connue.</p>
            )}
            <Chronologie jalons={jalons} />
          </section>

          <div className="space-y-4">
            <Rubrique titre="Identité">
              <Ligne libelle="E-mail">
                {d.upn ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="[overflow-wrap:anywhere]">{d.upn}</span>
                    <BoutonCopier upn={d.upn} nom={d.nom} />
                  </span>
                ) : (
                  ABSENT
                )}
              </Ligne>
              <Ligne libelle="Poste">{d.poste ?? ABSENT}</Ligne>
              <Ligne libelle="Service">{d.service ?? ABSENT}</Ligne>
              <Ligne libelle="Responsable">{d.manager?.nom ?? ABSENT}</Ligne>
              <Ligne libelle="Arrivée">{d.dateArrivee ? formatArrivee(d.dateArrivee) : ABSENT}</Ligne>
            </Rubrique>
            <Rubrique titre="Compte et accès">
              <Ligne libelle="Licence">
                <Licence d={d} />
              </Ligne>
              <Ligne libelle="Arrivants">
                <Groupe d={d} />
              </Ligne>
              <Ligne libelle="Dossier">
                <Dossier d={d} />
              </Ligne>
            </Rubrique>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Retour />
      {corps}
    </div>
  );
}
