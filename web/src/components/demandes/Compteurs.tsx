import { Skeleton } from '@/components/ui/skeleton';
import { GROUPES, compter, nbIncertaines, type Demande, type FiltreGroupe, type Groupe } from '@/lib/suivi';

const CELLULES: Record<Groupe, { libelle: string; aide: string }> = {
  attente: { libelle: 'En attente', aide: 'À valider par la direction' },
  activer: { libelle: 'À activer', aide: 'Jour d’arrivée atteint' },
  encours: { libelle: 'En cours', aide: 'Validées et en onboarding' },
  terminees: { libelle: 'Terminées', aide: 'Ce mois-ci, heure de Paris' },
};

interface Props {
  demandes: readonly Demande[];
  /** La liste est incomplète (100 demandes par statut au plus) : les nombres sont des minimums. */
  tronque: boolean;
  groupe: FiltreGroupe;
  onGroupe: (groupe: FiltreGroupe) => void;
}

/**
 * Quatre compteurs qui sont aussi le filtre : un clic ne garde que ce groupe, un second clic le retire (`aria-pressed`). Chaque
 * demande est dans un seul groupe au plus (lib/suivi.ts : `groupeDe`) ; une Terminée d'un mois précédent n'en a pas. « À activer » est la seule
 * cellule marquée quand elle n'est pas vide : c'est le travail du jour.
 */
export function Compteurs({ demandes, tronque, groupe, onGroupe }: Props) {
  const n = compter(demandes);
  const incertaines = nbIncertaines(demandes);
  return (
    <div role="group" aria-label="Filtrer par groupe de demandes" className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card md:grid-cols-4 md:divide-x">
      {GROUPES.map((g, i) => {
        const actif = groupe === g;
        const marque = g === 'activer' && n[g] > 0;
        // Liste incomplète : tous les nombres sont des minimums. Terminées : aussi quand des comptes ne disent pas leur mois de fin.
        const minimum = tronque || (g === 'terminees' && incertaines > 0);
        return (
          <button
            key={g}
            type="button"
            aria-pressed={actif}
            onClick={() => onGroupe(actif ? 'tous' : g)}
            className={`relative flex min-h-24 flex-col items-start gap-0.5 px-4 py-3 text-left outline-none focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset ${actif ? 'bg-accent' : 'hover:bg-muted/60'} ${i % 2 === 1 ? 'border-l md:border-l-0' : ''} ${i >= 2 ? 'border-t md:border-t-0' : ''}`}
          >
            {marque && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
            <span className="text-sm font-medium">{CELLULES[g].libelle}</span>
            <span className="text-3xl leading-tight font-semibold tracking-tight tabular-nums">
              {n[g]}
              {minimum && <span aria-hidden="true">+</span>}
              {minimum && <span className="sr-only"> au moins</span>}
            </span>
            <span className="text-xs text-muted-foreground">{CELLULES[g].aide}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Mêmes cellules, mêmes dimensions : rien ne saute quand les nombres arrivent. */
export function CompteursSquelette() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card md:grid-cols-4 md:divide-x">
      {GROUPES.map((g, i) => (
        <div key={g} className={`min-h-24 space-y-2 px-4 py-3 ${i % 2 === 1 ? 'border-l md:border-l-0' : ''} ${i >= 2 ? 'border-t md:border-t-0' : ''}`}>
          <Skeleton className="h-4 w-20 bg-foreground/10" />
          <Skeleton className="h-8 w-10 bg-foreground/10" />
          <Skeleton className="h-3 w-28 bg-foreground/10" />
        </div>
      ))}
    </div>
  );
}
