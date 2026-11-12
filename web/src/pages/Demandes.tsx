import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { Actualisation } from '@/components/demandes/Actualisation';
import { Barre } from '@/components/demandes/Barre';
import { Compteurs, CompteursSquelette } from '@/components/demandes/Compteurs';
import { NouvelleDemande } from '@/components/demandes/NouvelleDemande';
import { DemandesCartes, DemandesCartesSquelette } from '@/components/demandes/DemandesCartes';
import { DemandesTable, DemandesTableSquelette } from '@/components/demandes/DemandesTable';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useNow } from '@/hooks/useNow';
import { useDemandes } from '@/lib/contexteDemandes';
import type { DemandeCreee, DemandeSortie } from '@/lib/demandeForm';
import { useMoi } from '@/lib/moi';
import { jourAParis } from '@/lib/dates';
import { SUIVI_KEY, filtrerDemandes, type Demande } from '@/lib/suivi';
import { attendre, ligneCreee } from '@/lib/synchro';

/** Plafond côté API : au plus 100 demandes par statut. */
const PLAFOND = 100;
/** La ligne créée reste en évidence ce temps-là. */
const SURLIGNAGE_MS = 30_000;

export function Demandes() {
  // Liste, actions, recherche, filtre et tri vivent au-dessus des routes (lib/contexteDemandes.ts) : « retour » depuis une demande les retrouve.
  // Rien de tout cela ne va dans l'URL ni dans le stockage du navigateur (le terme est un nom).
  const { suivi, actions, surAction, terme, setTerme, groupe, setGroupe, tri, setTri, nouvelle, setNouvelle } = useDemandes();
  const bureau = useIsDesktop();
  const navigate = useNavigate();
  // « À venir » et « Aujourd'hui » dépendent du jour à Paris : recalculé quand il change (passage de minuit), sans re-trier le reste du temps.
  const jour = jourAParis(new Date(useNow(60_000)));

  const donnees = suivi.data;
  const queryClient = useQueryClient();
  const peutCreer = useMoi().data?.droits.creer === true;
  // Demande qui vient d'être créée : son id (ligne en évidence) et l'éventuel avertissement du serveur (responsable non posé). Gardée
  // par le fournisseur : le message survit à une visite du détail.
  const idNouvelle = nouvelle?.id || undefined; // '' : le surlignage est terminé, le message reste
  const nouvelleVisible = idNouvelle !== undefined && donnees?.demandes.some((d) => d.id === idNouvelle) === true;
  const lignes = {
    etats: actions.etats,
    onOuvrir: (d: Demande) => void navigate(`/demandes/${d.id}`),
    onAction: surAction,
    onFermer: (d: Demande) => actions.fermer(d.id),
    surlignee: idNouvelle || null,
  };
  // Une ligne créée, validée ou activée par l'écran attend que la réplication d'Entra la rende : `useSuivi` relit alors la liste
  // toutes les 5 s (lib/suivi.ts), borné à 3 minutes par lib/synchro.ts.
  useEffect(() => {
    if (idNouvelle === undefined || !nouvelleVisible) return;
    document.getElementById(`demande-${idNouvelle}`)?.scrollIntoView?.({ block: 'nearest' });
    const id = setTimeout(() => setNouvelle((n) => (n?.id === idNouvelle ? { ...n, id: '' } : n)), SURLIGNAGE_MS);
    return () => clearTimeout(id);
  }, [idNouvelle, nouvelleVisible, setNouvelle]);
  const surCreee = (creee: DemandeCreee, valeurs: DemandeSortie) => {
    const nom = `${valeurs.prenom} ${valeurs.nom}`; // le nom affiché que le serveur donne au compte
    setNouvelle({ id: creee.id, nom, avertissement: creee.avertissement });
    // La ligne est dans la liste tout de suite, sans attendre la réplication d'Entra. Sans actions : seul le serveur les décide, la
    // relecture (toutes les 5 s) les apporte avec la ligne.
    attendre(
      queryClient,
      ligneCreee({ id: creee.id, nom, upn: creee.userPrincipalName, poste: valeurs.poste, service: valeurs.service, typeContrat: valeurs.typeContrat, dateArrivee: valeurs.dateArrivee }),
    );
    // La ligne doit être visible : ni recherche ni filtre ne la masquent.
    setTerme('');
    setGroupe('tous');
    void queryClient.invalidateQueries({ queryKey: SUIVI_KEY });
  };
  const visibles = useMemo(() => (donnees ? filtrerDemandes(donnees.demandes, { terme, groupe, tri, aujourdhui: jour }) : []), [donnees, terme, groupe, tri, jour]);
  const filtre = terme.trim() !== '' || groupe !== 'tous';
  const reessayer = (
    <Button variant="outline" onClick={() => void suivi.refetch()} disabled={suivi.isFetching}>
      Réessayer
    </Button>
  );

  return (
    <section aria-labelledby="demandes-titre" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 id="demandes-titre" className="text-2xl font-semibold tracking-tight">
          Demandes
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Actualisation misAJourA={suivi.dataUpdatedAt} enCours={suivi.isFetching} />
          {peutCreer && <NouvelleDemande onCree={surCreee} onRelire={() => void queryClient.invalidateQueries({ queryKey: SUIVI_KEY })} />}
        </div>
      </div>

      {nouvelle && (
        <Alert role="status">
          <AlertTitle>Demande créée pour {nouvelle.nom}</AlertTitle>
          <AlertDescription>
            {nouvelle.avertissement === 'manager_non_affecte' ? (
              <p>
                Le compte existe, mais le <strong>responsable n’a pas pu être affecté</strong> : à poser dans Entra. Ne renvoyez pas la demande, cela créerait un doublon.
              </p>
            ) : (
              <p>Elle attend la validation de la direction.</p>
            )}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setNouvelle(null)}>
              Fermer ce message
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {actions.perdues.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Une action n’a pas abouti</AlertTitle>
          <AlertDescription>
            <p>
              L’action sur {actions.perdues.map((p) => p.nom).join(', ')} a échoué, et la demande n’est plus dans la liste : elle a sans doute été traitée ailleurs ou supprimée.
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={actions.fermerPerdues}>
              Fermer ce message
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {suivi.isPending && (
        <>
          <CompteursSquelette />
          <Barre desactive terme="" onTerme={() => {}} tri={tri} onTri={() => {}} />
          <div role="status">
            <span className="sr-only">Chargement des demandes…</span>
            {bureau ? <DemandesTableSquelette tri={tri} /> : <DemandesCartesSquelette />}
          </div>
        </>
      )}

      {/* Échec du premier chargement : rien à montrer d'autre que l'erreur. */}
      {suivi.isError && !donnees && (
        <div className="max-w-lg space-y-3">
          <ApiErrorAlert error={suivi.error} />
          {reessayer}
        </div>
      )}

      {donnees && (
        <>
          <Compteurs demandes={donnees.demandes} tronque={donnees.tronque} groupe={groupe} onGroupe={setGroupe} />
          <Barre terme={terme} onTerme={setTerme} tri={tri} onTri={setTri} />

          {/* Échec d'une actualisation : les dernières données restent affichées. */}
          {suivi.isError && (
            <div className="space-y-3">
              <ApiErrorAlert error={suivi.error} />
              {reessayer}
            </div>
          )}

          {donnees.tronque && (
            <Alert>
              <AlertTitle>Liste incomplète</AlertTitle>
              <AlertDescription>Certaines demandes ne sont pas affichées : l’API en renvoie {PLAFOND} au plus par statut.</AlertDescription>
            </Alert>
          )}

          {donnees.demandes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">Aucune demande en cours</p>
              <p className="mt-1 text-sm text-muted-foreground">Les nouvelles demandes d’onboarding apparaîtront ici.</p>
            </div>
          ) : (
            <>
              <p aria-live="polite" className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span>
                  {visibles.length} {visibles.length > 1 ? 'demandes' : 'demande'}
                  {filtre && ` sur ${donnees.demandes.length}`}
                </span>
                {groupe !== 'tous' && (
                  <Button size="xs" variant="outline" onClick={() => setGroupe('tous')}>
                    Tout afficher
                  </Button>
                )}
              </p>
              {visibles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="font-medium">Aucune demande ne correspond</p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => {
                      setTerme('');
                      setGroupe('tous');
                    }}
                  >
                    Effacer la recherche et le filtre
                  </Button>
                </div>
              ) : bureau ? (
                <DemandesTable demandes={visibles} tri={tri} aujourdhui={jour} {...lignes} />
              ) : (
                <DemandesCartes demandes={visibles} aujourdhui={jour} {...lignes} />
              )}
            </>
          )}
        </>
      )}

    </section>
  );
}
