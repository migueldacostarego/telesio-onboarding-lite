import type { TypeContrat } from '@/lib/typeContrat';

/** Type de contrat de la personne (employeeType). Rien pour un compte antérieur au formulaire par type : la liste n'affiche pas d'absence. */
export function TypeBadge({ type }: { type: TypeContrat | null | undefined }) {
  if (!type) return null;
  return (
    <span data-slot="type-contrat" className="inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap text-muted-foreground">
      {type}
    </span>
  );
}
