import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  /** Le mot de passe affiché : ouvert tant que la page le garde, jamais rouvert une fois fermé. */
  remise: { nom: string; motDePasse: string; regeneration: boolean } | null;
  onFermer: () => void;
}

/**
 * Mot de passe temporaire, **affiché une seule fois**. Il n'existe que dans le DOM de cette boîte et dans l'état React de la page :
 * ni adresse, ni stockage du navigateur, ni cache de requêtes, ni journal. À la fermeture l'état est vidé et il n'y a aucun moyen
 * de le revoir (Régénérer en pose un autre). Échap et le clic à côté ne ferment pas la boîte, pour ne pas le perdre par accident.
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
  const [copie, setCopie] = useState<'oui' | 'non' | null>(null);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(remise.motDePasse);
      setCopie('oui');
    } catch {
      setCopie('non');
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{remise.regeneration ? 'Nouveau mot de passe temporaire' : 'Mot de passe temporaire'} de {remise.nom}</DialogTitle>
        <DialogDescription>
          Remettez-le en main propre. Il ne sera <strong>plus affiché</strong> une fois cette fenêtre fermée.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <p
          data-slot="mot-de-passe-temporaire"
          className="rounded-md border bg-muted px-3 py-3 text-center font-mono text-xl font-semibold tracking-wider break-all select-all"
        >
          {remise.motDePasse}
        </p>
        <p className="text-sm text-muted-foreground">Utilisable dans quelques minutes (le temps qu’Entra le prenne en compte partout).</p>
        <p role="status" className="min-h-5 text-sm">
          {copie === 'oui' && 'Copié dans le presse-papiers.'}
          {copie === 'non' && 'Copie impossible ici : sélectionnez le mot de passe et copiez-le à la main.'}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => void copier()}>
          {copie === 'oui' ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          Copier
        </Button>
        <Button type="button" onClick={onFermer}>
          Fermer
        </Button>
      </DialogFooter>
    </>
  );
}
