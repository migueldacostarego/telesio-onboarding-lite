import { CheckIcon } from 'lucide-react';
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
