import { ArrowLeftIcon } from 'lucide-react';
import { Link } from 'react-router';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { ActionsLigne, MessageLigne } from '@/components/demandes/ActionsLigne';
import { EnTeteDetail } from '@/components/demandes/EnTeteDetail';
import { ErreurDetail } from '@/components/demandes/ErreurDetail';
import { CompteEtAcces, Identite } from '@/components/demandes/FicheDetail';
import { HistoriqueDetail } from '@/components/demandes/HistoriqueDetail';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { chronologie } from '@/lib/chronologie';
import { useDemandes } from '@/lib/contexteDemandes';
import type { DemandeDetail } from '@/lib/detail';
import { reconcilier } from '@/lib/detailDemande';

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

/** Le détail est lu : en-tête avec ses actions, historique, fiche. `erreur` : une relecture en arrière-plan a échoué, les données gardées restent affichées. */
function CorpsDemande({ d, erreur }: { d: DemandeDetail; erreur: unknown }) {
  const { actions, surAction, ligneListe, ligneDetail } = useDemandes();
  const etat = actions.etats[d.id];
  const { etape, statut, onboarding, actions: permises } = reconcilier(d, ligneListe);
  const jalons = chronologie({ detail: d, etape, onboarding, actions: permises, etat });
  return (
    <div className="space-y-6">
      <EnTeteDetail d={d} statut={statut}>
        {ligneDetail && <ActionsLigne demande={ligneDetail} etat={etat} onAction={(action) => surAction(ligneDetail, action)} />}
      </EnTeteDetail>
      <MessageLigne etat={etat} onFermer={() => actions.fermer(d.id)} />
      {erreur ? <ApiErrorAlert error={erreur} /> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <HistoriqueDetail jalons={jalons} enregistre={d.historique.enregistre} />
        <div className="space-y-4">
          <Identite d={d} />
          <CompteEtAcces d={d} statut={statut} />
        </div>
      </div>
    </div>
  );
}

/**
 * Page d'une demande : `/demandes/:id` (l'objectId est la seule donnée de l'adresse). Identité, licence, groupe des arrivants,
 * dossier SharePoint et chronologie complète, d'après `GET /api/demandes/:id`, lu par le fournisseur (au-dessus des routes). Les
 * boutons d'action portent sur `ligneDetail` : la ligne de la liste, ou celle du détail s'il est plus avancé ou si la liste ne la
 * contient pas (lib/detailDemande.ts).
 */
export function DetailDemande() {
  const { detail: requete } = useDemandes();
  const d = requete.data;

  let corps;
  if (requete.isPending) corps = <Chargement />;
  else if (!d) corps = <ErreurDetail error={requete.error} enCours={requete.isFetching} onReessayer={() => void requete.refetch()} />;
  else corps = <CorpsDemande d={d} erreur={requete.isError ? requete.error : null} />;

  return (
    <div className="space-y-4">
      <Retour />
      {corps}
    </div>
  );
}
