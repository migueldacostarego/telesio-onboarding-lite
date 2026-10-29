import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { verrouille, type EtatLigne } from '@/lib/actions';
import type { Demande } from '@/lib/suivi';

export interface PropsActions {
  demande: Demande;
  etat: EtatLigne | undefined;
  onValider: () => void;
  onRefuser: () => void;
}

const Attente = ({ children }: { children: string }) => (
  <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
    <Loader2Icon aria-hidden="true" className="size-3 shrink-0 animate-spin" />
    {children}
  </p>
);

/**
 * Boutons d'une ligne : seulement les actions que l'API propose pour la personne connectée (`actions`). Tant que quelque chose
 * tourne pour la ligne, rien n'y est cliquable : Valider porte alors le spinner (la validation peut durer 30 s).
 */
export function ActionsLigne({ demande, etat, onValider, onRefuser }: PropsActions) {
  const peutValider = demande.actions.includes('approuver');
  const peutRefuser = demande.actions.includes('refuser');
  const occupee = verrouille(etat);
  const validation = etat?.phase === 'en_cours' && etat.action === 'valider';
  const refus = etat?.phase === 'en_cours' && etat.action === 'refuser';
  if (!peutValider && !peutRefuser) return null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-2">
        {peutValider && (
          <Button size="sm" disabled={occupee} aria-busy={validation} aria-label={`Valider la demande de ${demande.nom}`} onClick={onValider}>
            {validation ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <CheckIcon aria-hidden="true" />}
            {validation ? 'Validation…' : 'Valider'}
          </Button>
        )}
        {peutRefuser && (
          <Button size="sm" variant="destructive" disabled={occupee} aria-busy={refus} aria-label={`Refuser la demande de ${demande.nom}`} onClick={onRefuser}>
            {refus ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <XIcon aria-hidden="true" />}
            {refus ? 'Refus…' : 'Refuser'}
          </Button>
        )}
      </div>
      {etat?.phase === 'compte_en_creation' && <Attente>Compte en cours de création</Attente>}
      {etat?.phase === 'licence_en_cours' && <Attente>Licence en cours d’attribution</Attente>}
    </div>
  );
}

/** Message de la ligne (erreur de l'API, ou licence toujours en cours après les revalidations) : sous la ligne ou dans la carte. */
export function MessageLigne({ etat, onFermer }: { etat: EtatLigne | undefined; onFermer: () => void }) {
  if (etat?.phase !== 'erreur' && etat?.phase !== 'licence_lente') return null;
  return (
    <div className="space-y-2">
      {etat.phase === 'erreur' ? (
        <ApiErrorAlert error={etat.error} />
      ) : (
        <Alert>
          <AlertTitle>Licence en cours d’attribution</AlertTitle>
          <AlertDescription>
            Entra met plus de temps que prévu. La validation a été retentée plusieurs fois : revalidez dans quelques minutes.
          </AlertDescription>
        </Alert>
      )}
      <Button size="sm" variant="outline" onClick={onFermer}>
        Fermer ce message
      </Button>
    </div>
  );
}
