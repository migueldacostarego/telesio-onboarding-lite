import { Progress } from '@/components/ui/progress';
import { NB_ETAPES } from '@/lib/suivi';

/** « 2 sur 4 » avec une petite barre (décorative : le texte dit la même chose). */
export function Progression({ etape }: { etape: number }) {
  const n = Math.min(NB_ETAPES, Math.max(0, Math.round(etape)));
  return (
    <div className="flex items-center gap-2">
      <Progress aria-hidden="true" value={(n / NB_ETAPES) * 100} className="w-16 shrink-0" />
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        <span className="sr-only">Étape </span>
        {n} sur {NB_ETAPES}
      </span>
    </div>
  );
}
