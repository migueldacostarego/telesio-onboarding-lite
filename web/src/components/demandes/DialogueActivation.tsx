import { KeyRoundIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  demande: { id: string; nom: string } | undefined;
  enCours: boolean;
  onConfirmer: () => void;
  onFermer: () => void;
}

/** Confirmation avant d'activer le compte : l'activation pose un mot de passe temporaire, affiché une seule fois ensuite. */
export function DialogueActivation({ demande, enCours, onConfirmer, onFermer }: Props) {
  const bloquer = (e: Event) => enCours && e.preventDefault();
  return (
    <Dialog open={demande !== undefined} onOpenChange={(ouvert) => !ouvert && !enCours && onFermer()}>
      <DialogContent showCloseButton={!enCours} onEscapeKeyDown={bloquer} onInteractOutside={bloquer}>
        <DialogHeader>
          <DialogTitle>Activer le compte de {demande?.nom} ?</DialogTitle>
          <DialogDescription>
            Le compte est activé et un mot de passe temporaire est posé. Il s’affiche <strong>une seule fois</strong>, à l’écran suivant : ayez de quoi le noter ou le copier, et remettez-le en main propre. À la première connexion, l’arrivant inscrit Microsoft Authenticator puis change ce mot de passe.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={enCours} onClick={onFermer}>
            Annuler
          </Button>
          <Button type="button" disabled={enCours} aria-busy={enCours} onClick={onConfirmer}>
            {enCours ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <KeyRoundIcon aria-hidden="true" />}
            {enCours ? 'Activation…' : 'Activer le compte'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
