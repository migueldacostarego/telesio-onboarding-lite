import { PlusIcon } from 'lucide-react';
import { Suspense, lazy, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DemandeCreee, DemandeSortie } from '@/lib/demandeForm';

// Chargé à la première ouverture : react-hook-form et zod n'alourdissent pas l'écran des personnes qui ne créent rien.
// Même origine ('self') : la CSP l'autorise comme les autres scripts.
const FormulaireDemande = lazy(() => import('@/components/demandes/FormulaireDemande').then((m) => ({ default: m.FormulaireDemande })));

/** Bouton « Nouvelle demande » et son panneau latéral. À n'afficher que si l'API donne le droit `creer`. */
export function NouvelleDemande({ onCree, onRelire }: { onCree: (creee: DemandeCreee, valeurs: DemandeSortie) => void; onRelire: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const liste = useRef<{ ouverte: boolean; fermer: () => void } | null>(null);
  return (
    <Sheet open={ouvert} onOpenChange={(o) => (o || !envoi) && setOuvert(o)}>
      <Button onClick={() => setOuvert(true)}>
        <PlusIcon aria-hidden="true" />
        Nouvelle demande
      </Button>
      <SheetContent
        className="w-full sm:max-w-lg"
        showCloseButton={!envoi}
        // Un clic à côté ne ferme jamais le panneau (une saisie perdue par un clic de travers) ; Échap, sauf pendant l'envoi,
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
              <>
                <SheetHeader>
                  <SheetTitle>Nouvelle demande</SheetTitle>
                  <SheetDescription role="status">Chargement du formulaire…</SheetDescription>
                </SheetHeader>
              </>
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
      </SheetContent>
    </Sheet>
  );
}
