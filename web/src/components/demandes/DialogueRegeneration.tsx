import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MOTIFS_REGENERATION, type MotifRegeneration } from '@/lib/actions';

interface Props {
  demande: { id: string; nom: string } | undefined;
  enCours: boolean;
  onConfirmer: (motif: MotifRegeneration) => void;
  onFermer: () => void;
}

/**
 * Nouveau mot de passe temporaire pour un compte Actif. Motif obligatoire, **choisi parmi des codes** (l'API refuse le texte
 * libre, qui pourrait contenir un nom) : une liste de choix, pas une zone de texte.
 */
export function DialogueRegeneration({ demande, enCours, onConfirmer, onFermer }: Props) {
  const bloquer = (e: Event) => enCours && e.preventDefault();
  return (
    <Dialog open={demande !== undefined} onOpenChange={(ouvert) => !ouvert && !enCours && onFermer()}>
      <DialogContent showCloseButton={!enCours} onEscapeKeyDown={bloquer} onInteractOutside={bloquer}>
        {demande && <Formulaire key={demande.id} nom={demande.nom} enCours={enCours} onConfirmer={onConfirmer} onFermer={onFermer} />}
      </DialogContent>
    </Dialog>
  );
}

function Formulaire({ nom, enCours, onConfirmer, onFermer }: { nom: string; enCours: boolean; onConfirmer: Props['onConfirmer']; onFermer: () => void }) {
  const [motif, setMotif] = useState<MotifRegeneration | null>(null);
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (motif && !enCours) onConfirmer(motif);
      }}
    >
      <DialogHeader>
        <DialogTitle>Régénérer le mot de passe de {nom} ?</DialogTitle>
        <DialogDescription>
          Un nouveau mot de passe temporaire est posé et affiché une seule fois. L’ancien ne fonctionne plus ; si l’arrivant en avait déjà choisi un, il devra le changer de nouveau.
        </DialogDescription>
      </DialogHeader>
      <fieldset className="grid gap-2" disabled={enCours}>
        <legend className="mb-1 text-sm font-medium">Motif (obligatoire)</legend>
        {MOTIFS_REGENERATION.map((m) => (
          <label key={m.code} className="flex items-center gap-2 text-sm">
            <input type="radio" name="motif-regeneration" value={m.code} checked={motif === m.code} onChange={() => setMotif(m.code)} className="size-4 accent-primary" />
            {m.libelle}
          </label>
        ))}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={enCours} onClick={onFermer}>
          Annuler
        </Button>
        <Button type="submit" disabled={motif === null || enCours} aria-busy={enCours}>
          {enCours && <Loader2Icon aria-hidden="true" className="animate-spin" />}
          {enCours ? 'Régénération…' : 'Régénérer le mot de passe'}
        </Button>
      </DialogFooter>
    </form>
  );
}
