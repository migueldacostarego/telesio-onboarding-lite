import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { MOTIF_MAX } from '@/lib/actions';

interface Props {
  /** La demande à refuser, ou `undefined` : fermée. */
  demande: { id: string; nom: string } | undefined;
  /** Le refus est parti : rien ne se ferme ni ne se modifie tant que le serveur n'a pas répondu. */
  enCours: boolean;
  onConfirmer: (motif: string) => void;
  onFermer: () => void;
}

/**
 * Refus d'une demande : motif obligatoire (500 caractères au plus) puis confirmation explicite, car le compte est supprimé.
 * Le motif ne vit que dans ce formulaire (état local, démonté à la fermeture) : ni URL, ni stockage, ni cache.
 */
export function DialogueRefus({ demande, enCours, onConfirmer, onFermer }: Props) {
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
  const [motif, setMotif] = useState('');
  const net = motif.trim();
  const valide = net.length > 0 && net.length <= MOTIF_MAX;
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (valide && !enCours) onConfirmer(net);
      }}
    >
      <DialogHeader>
        <DialogTitle>Refuser la demande de {nom} ?</DialogTitle>
        <DialogDescription>
          Le compte Entra sera supprimé (corbeille, récupérable pendant 30 jours) et la demande disparaîtra de la liste. Le motif n’est conservé nulle part.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="motif-refus">Motif du refus (obligatoire)</FieldLabel>
        <Textarea
          id="motif-refus"
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          maxLength={MOTIF_MAX}
          required
          disabled={enCours}
          autoComplete="off"
          aria-describedby="motif-refus-aide"
        />
        <FieldDescription id="motif-refus-aide">
          {net.length === 0 ? 'Saisissez le motif pour pouvoir confirmer. ' : ''}
          {motif.length}/{MOTIF_MAX} caractères
        </FieldDescription>
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={enCours} onClick={onFermer}>
          Annuler
        </Button>
        <Button type="submit" variant="destructive" disabled={!valide || enCours} aria-busy={enCours}>
          {enCours && <Loader2Icon aria-hidden="true" className="animate-spin" />}
          {enCours ? 'Refus en cours…' : 'Confirmer le refus'}
        </Button>
      </DialogFooter>
    </form>
  );
}
