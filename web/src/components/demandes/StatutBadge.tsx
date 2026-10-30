import { Loader2Icon } from 'lucide-react';
import { LIBELLES, type Statut } from '@/lib/suivi';

/**
 * Teintes sémantiques douces (fond très clair, bord, texte foncé : contraste AA) : orange ce qui attend une décision, bleu ce qui
 * est prêt, violet ce qui est en route, vert ce qui est fini. Le libellé dit toujours le statut et le point est décoratif : la
 * couleur ne porte aucune information à elle seule.
 */
const STYLES: Record<Statut, { badge: string; point: string }> = {
  EnAttente: { badge: 'border-amber-200 bg-amber-50 text-amber-900', point: 'bg-amber-500' },
  Validé: { badge: 'border-blue-200 bg-blue-50 text-blue-900', point: 'bg-blue-600' },
  Actif: { badge: 'border-violet-200 bg-violet-50 text-violet-900', point: 'bg-violet-600' },
  Terminé: { badge: 'border-green-200 bg-green-50 text-green-900', point: 'bg-green-600' },
};

export function StatutBadge({ statut }: { statut: Statut }) {
  const s = STYLES[statut] ?? STYLES.EnAttente;
  return (
    <span data-slot="statut" data-statut={statut} className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap ${s.badge}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${s.point}`} />
      {LIBELLES[statut] ?? statut}
    </span>
  );
}

/** Sur une ligne que l'écran vient d'écrire et que l'API ne rend pas encore (réplication d'Entra) : lib/synchro.ts. */
export function Synchronisation({ synchro }: { synchro: boolean | undefined }) {
  if (!synchro) return null;
  return (
    <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2Icon aria-hidden="true" className="size-3 shrink-0 animate-spin" />
      synchronisation…
    </p>
  );
}
