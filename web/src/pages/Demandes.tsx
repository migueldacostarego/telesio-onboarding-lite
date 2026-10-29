import { useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { Actualisation } from '@/components/demandes/Actualisation';
import { Barre } from '@/components/demandes/Barre';
import { DialogueActivation } from '@/components/demandes/DialogueActivation';
import { DialogueMotDePasse } from '@/components/demandes/DialogueMotDePasse';
import { DialogueRefus } from '@/components/demandes/DialogueRefus';
import { DialogueRegeneration } from '@/components/demandes/DialogueRegeneration';
import { DemandesCartes, DemandesCartesSquelette } from '@/components/demandes/DemandesCartes';
import { DemandesTable, DemandesTableSquelette } from '@/components/demandes/DemandesTable';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useActionsDemandes } from '@/hooks/useActionsDemandes';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useTerminaisonAuto } from '@/hooks/useTerminaisonAuto';
import { useNow } from '@/hooks/useNow';
import type { ActionNom } from '@/lib/actions';
import { aujourdhui, filtrerDemandes, useSuivi, type Demande, type FiltreStatut, type Tri } from '@/lib/suivi';

/** Plafond côté API : au plus 100 demandes par statut. */
const PLAFOND = 100;

export function Demandes() {
  const suivi = useSuivi();
  const bureau = useIsDesktop();
  // Rien de tout cela ne va dans l'URL ni dans le stockage du navigateur (le terme est un nom).
  const [terme, setTerme] = useState('');
  const [statut, setStatut] = useState<FiltreStatut>('tous');
  const [tri, setTri] = useState<Tri>('avenir');
  // « À venir » dépend du jour : recalculé quand il change (passage de minuit), sans re-trier le reste du temps.
  const jour = aujourdhui(new Date(useNow(60_000)));

  const donnees = suivi.data;
  // Le mot de passe temporaire n'existe qu'ici et dans la boîte qui l'affiche : état React seulement (ni URL, ni stockage, ni cache).
  const [remise, setRemise] = useState<{ nom: string; motDePasse: string; regeneration: boolean } | null>(null);
  // La boîte de dialogue ouverte vise une demande par son id (état de la page : elle survit aux filtres et au tri).
  const [cible, setCible] = useState<{ action: Exclude<ActionNom, 'valider'>; id: string } | null>(null);
  const actions = useActionsDemandes(donnees?.demandes, {
    onRemise: ({ id, motDePasse, regeneration }) => {
      setRemise({ nom: donnees?.demandes.find((d) => d.id === id)?.nom ?? '', motDePasse, regeneration });
      setCible(null);
    },
  });
  useTerminaisonAuto(donnees?.demandes, suivi.dataUpdatedAt);
  const demandeCible = cible === null ? undefined : donnees?.demandes.find((d) => d.id === cible.id);
  const etatCible = cible === null ? undefined : actions.etats[cible.id];
  const cibleEnCours = cible !== null && etatCible?.phase === 'en_cours' && etatCible.action === cible.action;
  // La demande n'offre plus l'action (traitée ailleurs, ou disparue) : la boîte se ferme, sauf si l'action est déjà partie.
  const ouverte = cible !== null && demandeCible && (demandeCible.actions.includes(cible.action) || cibleEnCours) ? demandeCible : undefined;
  const boite = (action: Exclude<ActionNom, 'valider'>) => (cible?.action === action ? ouverte : undefined);
  const lignes = {
    etats: actions.etats,
    onAction: (d: Demande, action: ActionNom) => (action === 'valider' ? actions.valider(d.id) : setCible({ action, id: d.id })),
    onFermer: (d: Demande) => actions.fermer(d.id),
  };
  const visibles = useMemo(() => (donnees ? filtrerDemandes(donnees.demandes, { terme, statut, tri, aujourdhui: jour }) : []), [donnees, terme, statut, tri, jour]);
  const filtre = terme.trim() !== '' || statut !== 'tous';
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
        <Actualisation misAJourA={suivi.dataUpdatedAt} enCours={suivi.isFetching} />
      </div>

      {suivi.isPending && (
        <>
          <Barre desactive terme="" onTerme={() => {}} statut="tous" onStatut={() => {}} tri={tri} onTri={() => {}} />
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
          <Barre terme={terme} onTerme={setTerme} statut={statut} onStatut={setStatut} tri={tri} onTri={setTri} />

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
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {visibles.length} {visibles.length > 1 ? 'demandes' : 'demande'}
                {filtre && ` sur ${donnees.demandes.length}`}
              </p>
              {visibles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="font-medium">Aucune demande ne correspond</p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => {
                      setTerme('');
                      setStatut('tous');
                    }}
                  >
                    Effacer la recherche et le filtre
                  </Button>
                </div>
              ) : bureau ? (
                <DemandesTable demandes={visibles} tri={tri} {...lignes} />
              ) : (
                <DemandesCartes demandes={visibles} {...lignes} />
              )}
            </>
          )}
        </>
      )}

      <DialogueRefus
        demande={boite('refuser')}
        enCours={cibleEnCours}
        onFermer={() => setCible(null)}
        onConfirmer={(motif) => cible && void actions.refuser(cible.id, motif).then(() => setCible(null))}
      />
      <DialogueActivation
        demande={boite('activer')}
        enCours={cibleEnCours}
        onFermer={() => setCible(null)}
        onConfirmer={() => cible && void actions.activer(cible.id).then(() => setCible(null))}
      />
      <DialogueRegeneration
        demande={boite('regenerer')}
        enCours={cibleEnCours}
        onFermer={() => setCible(null)}
        onConfirmer={(motif) => cible && void actions.regenerer(cible.id, motif).then(() => setCible(null))}
      />
      <DialogueMotDePasse remise={remise} onFermer={() => setRemise(null)} />
    </section>
  );
}
