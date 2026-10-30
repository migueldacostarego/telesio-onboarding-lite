import { Loader2Icon } from 'lucide-react';
import { BOUTONS } from '@/components/demandes/boutons';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { verrouille, type ActionNom, type EtatLigne } from '@/lib/actions';
import type { Demande } from '@/lib/suivi';

export interface PropsActions {
  demande: Demande;
  etat: EtatLigne | undefined;
  onAction: (action: ActionNom) => void;
  /** Tableau : les boutons restent sur une ligne (la colonne est assez large pour deux), la hauteur de la ligne ne change pas. */
  surUneLigne?: boolean;
}

const Attente = ({ children }: { children: string }) => (
  <p role="status" className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
    <Loader2Icon aria-hidden="true" className="size-3 shrink-0 animate-spin" />
    {children}
  </p>
);

/**
 * Boutons d'une ligne : seulement les actions que l'API propose pour la personne connectée (`actions`). Tant que quelque chose
 * tourne pour la ligne, rien n'y est cliquable : le bouton de l'action en cours porte le spinner (la validation peut durer 30 s).
 */
export function ActionsLigne({ demande, etat, onAction, surUneLigne = false }: PropsActions) {
  const proposes = BOUTONS.filter((b) => demande.actions.includes(b.api));
  const occupee = verrouille(etat);
  if (proposes.length === 0) return null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className={`flex gap-2 ${surUneLigne ? 'flex-nowrap' : 'flex-wrap'}`}>
        {proposes.map(({ action, libelle, nom, variante, Icone }) => {
          const enCours = etat?.phase === 'en_cours' && etat.action === action;
          return (
            <Button key={action} size="sm" variant={variante} className={variante === 'destructive' ? 'bg-red-50 text-red-800 hover:bg-red-100' : undefined} disabled={occupee} aria-busy={enCours} aria-label={nom(demande.nom)} onClick={() => onAction(action)}>
              {enCours ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <Icone aria-hidden="true" />}
              {libelle}
            </Button>
          );
        })}
      </div>
      {etat?.phase === 'en_cours' && (
        <span role="status" className="sr-only">
          {BOUTONS.find((b) => b.action === etat.action)?.attente}
        </span>
      )}
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
