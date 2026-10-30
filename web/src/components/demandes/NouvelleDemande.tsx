import { PlusIcon } from 'lucide-react';
import { Suspense, lazy, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DemandeCreee, DemandeSortie } from '@/lib/demandeForm';

// Chargé à la première ouverture : react-hook-form et zod n'alourdissent pas l'écran des personnes qui ne créent rien.
// Même origine ('self') : la CSP l'autorise comme les autres scripts.
const FormulaireDemande = lazy(() => import('@/components/demandes/FormulaireDemande').then((m) => ({ default: m.FormulaireDemande })));

/** Bouton « Nouvelle demande » et sa fenêtre (560 px). À n'afficher que si l'API donne le droit `creer`. */
export function NouvelleDemande({ onCree, onRelire }: { onCree: (creee: DemandeCreee, valeurs: DemandeSortie) => void; onRelire: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const liste = useRef<{ ouverte: boolean; fermer: () => void } | null>(null);
  return (
    <Dialog open={ouvert} onOpenChange={(o) => (o || !envoi) && setOuvert(o)}>
      <Button onClick={() => setOuvert(true)}>
        <PlusIcon aria-hidden="true" />
        Nouvelle demande
      </Button>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
        showCloseButton={!envoi}
        // Un clic à côté ne ferme jamais la fenêtre (une saisie perdue par un clic de travers) ; Échap, sauf pendant l'envoi,
        // ferme d'abord la liste des résultats si elle est ouverte.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (envoi) e.preventDefault();
          else if (liste.current?.ouverte) {
            e.preventDefault();
            liste.current.fermer();
          }
        }}
      >
        {ouvert && (
          <Suspense
            fallback={
              <DialogHeader className="px-6 py-6 pr-12">
                <DialogTitle className="text-base">Nouvelle demande</DialogTitle>
                <DialogDescription role="status">Chargement du formulaire…</DialogDescription>
              </DialogHeader>
            }
          >
            <FormulaireDemande
              controleListe={liste}
              onEnvoi={setEnvoi}
              onAnnuler={() => setOuvert(false)}
              onRelire={onRelire}
              onCree={(creee, valeurs) => {
                setOuvert(false);
                onCree(creee, valeurs);
              }}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
