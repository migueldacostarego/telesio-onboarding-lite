import { Loader2Icon } from 'lucide-react';
import { Synchronisation } from '@/components/demandes/StatutBadge';
import type { EtatLigne as Etat } from '@/lib/actions';
import { sousTitre } from '@/lib/etat';
import type { Demande } from '@/lib/suivi';

/**
 * La ligne de texte sous le statut : une attente en cours (compte en création, licence), la synchronisation d'Entra, ou où en est la
 * demande et ce qu'on attend (lib/etat.ts). Une ligne, tronquée, la phrase entière en infobulle : la hauteur de la ligne ne change pas.
 */
export function EtatLigne({ demande, etat, aujourdhui }: { demande: Demande; etat: Etat | undefined; aujourdhui: string }) {
  const attente = etat?.phase === 'compte_en_creation' ? 'Compte en cours de création' : etat?.phase === 'licence_en_cours' ? 'Licence en cours d’attribution' : null;
  if (attente) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon aria-hidden="true" className="size-3 shrink-0 animate-spin" />
        <span className="truncate">{attente}</span>
      </p>
    );
  }
  if (demande.synchro) return <Synchronisation synchro />;
  const { texte, alerte } = sousTitre(demande, aujourdhui);
  return (
    <p title={texte} className={`truncate text-xs ${alerte ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
      {texte}
    </p>
  );
}
