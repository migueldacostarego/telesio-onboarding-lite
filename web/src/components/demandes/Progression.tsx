import { useDevientVrai } from '@/hooks/useAnimations';
import { NB_ETAPES } from '@/lib/suivi';

/**
 * Quatre segments : demande, validée, activée, terminée. Le texte « Étape n sur 4 » est dit aux lecteurs d'écran ; les segments sont
 * décoratifs (et en couleurs neutres : remplis = faits).
 */
export function Progression({ etape }: { etape: number }) {
  const n = Math.min(NB_ETAPES, Math.max(0, Math.round(etape)));
  return (
    <span className="inline-flex items-center gap-0.5" data-etape={n}>
      <span className="sr-only">
        Étape {n} sur {NB_ETAPES}
      </span>
      {Array.from({ length: NB_ETAPES }, (_, i) => (
        <Segment key={i} rempli={i < n} />
      ))}
    </span>
  );
}

/** Un segment ; celui qui vient d'être rempli pulse une fois. */
function Segment({ rempli }: { rempli: boolean }) {
  const franchi = useDevientVrai(rempli);
  return (
    <span
      aria-hidden="true"
      data-pulsation={franchi || undefined}
      className={`h-1.5 w-3 rounded-full transition-colors duration-300 ease-out ${rempli ? 'bg-foreground/70' : 'bg-foreground/15'} ${franchi ? 'animate-pulsation' : ''}`}
    />
  );
}
