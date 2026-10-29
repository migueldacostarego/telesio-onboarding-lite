import { CheckIcon, KeyRoundIcon, Loader2Icon, PowerIcon, XIcon, type LucideIcon } from 'lucide-react';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { verrouille, type ActionNom, type EtatLigne } from '@/lib/actions';
import type { Demande } from '@/lib/suivi';

export interface PropsActions {
  demande: Demande;
  etat: EtatLigne | undefined;
  onAction: (action: ActionNom) => void;
}

const Attente = ({ children }: { children: string }) => (
  <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
    <Loader2Icon aria-hidden="true" className="size-3 shrink-0 animate-spin" />
    {children}
  </p>
);

interface Bouton {
  /** Entrée de `actions` (API) qui le propose. */
  api: string;
  action: ActionNom;
  libelle: string;
  /** Texte pendant l'attente (le spinner remplace l'icône). */
  attente: string;
  /** Nom accessible : « Valider la demande de … ». */
  nom: (nom: string) => string;
  variante: 'default' | 'destructive' | 'outline';
  Icone: LucideIcon;
}

/** Ordre d'affichage. Un bouton n'existe que si l'API le propose pour la personne connectée (`actions`). */
const BOUTONS: Bouton[] = [
  { api: 'approuver', action: 'valider', libelle: 'Valider', attente: 'Validation…', nom: (n) => `Valider la demande de ${n}`, variante: 'default', Icone: CheckIcon },
  { api: 'refuser', action: 'refuser', libelle: 'Refuser', attente: 'Refus…', nom: (n) => `Refuser la demande de ${n}`, variante: 'destructive', Icone: XIcon },
  { api: 'activer', action: 'activer', libelle: 'Activer', attente: 'Activation…', nom: (n) => `Activer le compte de ${n}`, variante: 'default', Icone: PowerIcon },
  { api: 'regenerer', action: 'regenerer', libelle: 'Régénérer', attente: 'Régénération…', nom: (n) => `Régénérer le mot de passe de ${n}`, variante: 'outline', Icone: KeyRoundIcon },
];

/**
 * Boutons d'une ligne : seulement les actions que l'API propose pour la personne connectée (`actions`). Tant que quelque chose
 * tourne pour la ligne, rien n'y est cliquable : le bouton de l'action en cours porte le spinner (la validation peut durer 30 s).
 */
export function ActionsLigne({ demande, etat, onAction }: PropsActions) {
  const proposes = BOUTONS.filter((b) => demande.actions.includes(b.api));
  const occupee = verrouille(etat);
  if (proposes.length === 0) return null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-2">
        {proposes.map(({ action, libelle, attente, nom, variante, Icone }) => {
          const enCours = etat?.phase === 'en_cours' && etat.action === action;
          return (
            <Button key={action} size="sm" variant={variante} disabled={occupee} aria-busy={enCours} aria-label={nom(demande.nom)} onClick={() => onAction(action)}>
              {enCours ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <Icone aria-hidden="true" />}
              {enCours ? attente : libelle}
            </Button>
          );
        })}
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
