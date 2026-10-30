import { CheckIcon, Loader2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LIBELLES, type Statut } from '@/lib/suivi';

const VARIANTES: Record<Statut, 'outline' | 'secondary' | 'default'> = {
  EnAttente: 'outline',
  Validé: 'secondary',
  Actif: 'default',
  Terminé: 'secondary',
};

/** Le libellé dit toujours le statut : la forme du badge ne porte aucune information à elle seule. */
export function StatutBadge({ statut }: { statut: Statut }) {
  return (
    <Badge variant={VARIANTES[statut] ?? 'outline'} className="whitespace-nowrap">
      {statut === 'Terminé' && <CheckIcon />}
      {LIBELLES[statut] ?? statut}
    </Badge>
  );
}

/** Sur une ligne que l'écran vient d'écrire et que l'API ne rend pas encore (réplication d'Entra) : lib/synchro.ts. */
export function Synchronisation({ synchro }: { synchro: boolean | undefined }) {
  if (!synchro) return null;
  return (
    <p role="status" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2Icon aria-hidden="true" className="size-3 shrink-0 animate-spin" />
      synchronisation…
    </p>
  );
}
