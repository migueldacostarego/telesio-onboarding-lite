import { ArrowDownIcon, ArrowUpIcon, CalendarClockIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LIBELLES, STATUTS, type FiltreStatut, type Tri } from '@/lib/suivi';

interface Props {
  terme: string;
  onTerme: (terme: string) => void;
  statut: FiltreStatut;
  onStatut: (statut: FiltreStatut) => void;
  tri: Tri;
  onTri: (tri: Tri) => void;
  /** Pendant le chargement initial : les commandes sont visibles mais inactives. */
  desactive?: boolean;
}

const FILTRES: { valeur: FiltreStatut; libelle: string }[] = [
  { valeur: 'tous', libelle: 'Toutes' },
  ...STATUTS.map((s) => ({ valeur: s, libelle: LIBELLES[s] })),
];

/**
 * Recherche, filtre par statut et tri par date d'arrivée. Tout reste en mémoire du composant : le terme de recherche
 * (un nom) ne va jamais dans l'URL, ni dans le stockage du navigateur.
 */
export function Barre({ terme, onTerme, statut, onStatut, tri, onTri, desactive }: Props) {
  const ORDRES: Record<Tri, { libelle: string; suivant: Tri }> = {
    avenir: { libelle: 'à venir d’abord', suivant: 'recentes' },
    recentes: { libelle: 'plus récentes d’abord', suivant: 'anciennes' },
    anciennes: { libelle: 'plus anciennes d’abord', suivant: 'avenir' },
  };
  const ordre = ORDRES[tri];
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Rechercher par nom"
            placeholder="Rechercher par nom"
            autoComplete="off"
            spellCheck={false}
            className="pl-8"
            value={terme}
            disabled={desactive}
            onChange={(e) => onTerme(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => onTri(ordre.suivant)} disabled={desactive} className="self-start sm:self-auto">
          {tri === 'recentes' ? <ArrowDownIcon /> : tri === 'anciennes' ? <ArrowUpIcon /> : <CalendarClockIcon />}
          Arrivée : {ordre.libelle}
        </Button>
      </div>
      <div role="group" aria-label="Filtrer par statut" className="flex flex-wrap gap-1.5">
        {FILTRES.map((f) => (
          <Button
            key={f.valeur}
            size="sm"
            variant={statut === f.valeur ? 'default' : 'outline'}
            aria-pressed={statut === f.valeur}
            disabled={desactive}
            onClick={() => onStatut(f.valeur)}
          >
            {f.libelle}
          </Button>
        ))}
      </div>
    </div>
  );
}
