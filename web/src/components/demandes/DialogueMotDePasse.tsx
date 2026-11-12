import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface Props {
  /** Le mot de passe affiché : ouvert tant que la page le garde, jamais rouvert une fois fermé. */
  remise: { nom: string; motDePasse: string; regeneration: boolean } | null;
  onFermer: () => void;
}

/**
 * Mot de passe temporaire, **affiché une seule fois**. Il n'existe que dans le DOM de cette boîte et dans l'état React de la page :
 * ni adresse, ni stockage du navigateur, ni cache de requêtes, ni journal, ni presse-papiers écrit par l'application. À la
 * fermeture l'état est vidé et il n'y a aucun moyen de le revoir (Régénérer en pose un autre). Échap et le clic à côté ne ferment
 * pas la boîte, pour ne pas le perdre par accident.
 */
export function DialogueMotDePasse({ remise, onFermer }: Props) {
  const bloquer = (e: Event) => e.preventDefault();
  return (
    <Dialog open={remise !== null} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={bloquer} onInteractOutside={bloquer}>
        {remise && <Corps remise={remise} onFermer={onFermer} />}
      </DialogContent>
    </Dialog>
  );
}

function Corps({ remise, onFermer }: { remise: NonNullable<Props['remise']>; onFermer: () => void }) {
  const id = useId();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{remise.regeneration ? 'Nouveau mot de passe temporaire' : 'Mot de passe temporaire'} de {remise.nom}</DialogTitle>
        <DialogDescription>
          Remettez-le en main propre. Il ne sera <strong>plus affiché</strong> une fois cette fenêtre fermée.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor={id}>Mot de passe temporaire</Label>
        {/*
          Pas de bouton Copier : le presse-papiers du système (historique, synchronisation) garderait le mot de passe hors du DOM.
          Champ en lecture seule, premier élément focalisable de la boîte : lu à l'ouverture, sélectionné au focus, copiable à la
          main au clavier comme à la souris.
        */}
        <input
          id={id}
          data-slot="mot-de-passe-temporaire"
          readOnly
          value={remise.motDePasse}
          onFocus={(e) => e.currentTarget.select()}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border bg-muted px-3 py-3 text-center font-mono text-xl font-semibold tracking-wider outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-sm text-muted-foreground">Utilisable dans quelques minutes (le temps qu’Entra le prenne en compte partout).</p>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onFermer}>
          Fermer
        </Button>
      </DialogFooter>
    </>
  );
}
