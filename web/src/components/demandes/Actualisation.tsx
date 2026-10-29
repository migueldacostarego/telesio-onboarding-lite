import { Loader2Icon } from 'lucide-react';
import { useNow } from '@/hooks/useNow';
import { ilYA } from '@/lib/suivi';

/** « Mis à jour il y a 20 s » : vieillit seul, et un petit indicateur tourne pendant l'actualisation (sans décaler le texte). */
export function Actualisation({ misAJourA, enCours }: { misAJourA: number; enCours: boolean }) {
  const now = useNow(5_000);
  if (!misAJourA) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="off">
      <Loader2Icon aria-hidden="true" className={`size-3 animate-spin ${enCours ? '' : 'invisible'}`} />
      <span>Mis à jour {ilYA(misAJourA, now)}</span>
    </p>
  );
}
