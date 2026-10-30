import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/useDebounced';
import { ATTENTE_RECHERCHE_MS, TERME_MAX, TERME_MIN, normaliserTerme, useAnnuaire, type Personne } from '@/lib/annuaire';

interface Props {
  id: string;
  choisi: Personne | null;
  onChoisir: (personne: Personne | null) => void;
  invalide?: boolean;
  decritPar?: string;
  /** Renseigné par le champ : la liste est-elle ouverte (Échap doit alors la fermer avant de fermer le panneau) ? */
  controleRef: { current: { ouverte: boolean; fermer: () => void } | null };
}

/**
 * Responsable : recherche dans l'annuaire (2 caractères au moins, 300 ms après la dernière frappe), motif ARIA « combobox ».
 * Le terme reste dans l'état du composant : jamais dans l'adresse de la page ni dans le stockage du navigateur.
 */
export function ChoixManager({ id, choisi, onChoisir, invalide, decritPar, controleRef }: Props) {
  const listeId = useId();
  const [saisie, setSaisie] = useState('');
  const [ouverte, setOuverte] = useState(false);
  const [actif, setActif] = useState(-1);
  const terme = useDebounced(normaliserTerme(saisie), ATTENTE_RECHERCHE_MS);
  const recherche = useAnnuaire(terme);
  const resultats = recherche.data ?? [];
  const assez = normaliserTerme(saisie).length >= TERME_MIN;
  const enAttente = assez && (normaliserTerme(saisie) !== terme || recherche.isFetching);
  const montrer = ouverte && assez && !enAttente && !recherche.isError;
  useEffect(() => {
    controleRef.current = { ouverte: montrer, fermer: () => setOuverte(false) };
    return () => {
      controleRef.current = null;
    };
  }, [controleRef, montrer]);

  const choisir = (p: Personne) => {
    onChoisir(p);
    setSaisie('');
    setOuverte(false);
    setActif(-1);
  };

  if (choisi) {
    return (
      <div id={id} className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{choisi.displayName}</p>
          {choisi.mail && <p className="truncate text-xs text-muted-foreground">{choisi.mail}</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChoisir(null)} aria-label={`Changer de responsable (actuellement ${choisi.displayName})`}>
          <XIcon aria-hidden="true" />
          Changer
        </Button>
      </div>
    );
  }

  return (
    <div className="relative space-y-1.5">
      <div className="relative">
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          role="combobox"
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={TERME_MAX}
          className="pl-8 text-foreground"
          placeholder="Nom ou email du responsable"
          aria-expanded={montrer}
          aria-controls={listeId}
          aria-autocomplete="list"
          aria-activedescendant={montrer && actif >= 0 ? `${listeId}-${actif}` : undefined}
          aria-invalid={invalide || undefined}
          aria-describedby={decritPar}
          value={saisie}
          onChange={(e) => {
            setSaisie(e.target.value);
            setOuverte(true);
            setActif(-1);
          }}
          onFocus={() => setOuverte(true)}
          onBlur={() => setOuverte(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && resultats.length > 0) {
              e.preventDefault();
              setOuverte(true);
              setActif((a) => (a + 1) % resultats.length);
            } else if (e.key === 'ArrowUp' && resultats.length > 0) {
              e.preventDefault();
              setActif((a) => (a <= 0 ? resultats.length - 1 : a - 1));
            } else if (e.key === 'Enter') {
              // Jamais d'envoi du formulaire depuis ce champ : Entrée choisit l'option active, sinon ne fait rien.
              e.preventDefault();
              const p = montrer ? resultats[actif] : undefined;
              if (p) choisir(p);
            }
          }}
        />
      </div>
      <ul id={listeId} role="listbox" aria-label="Résultats de la recherche" hidden={!montrer || resultats.length === 0} className="max-h-56 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
        {resultats.map((p, i) => (
          <li
            key={p.id}
            id={`${listeId}-${i}`}
            role="option"
            aria-selected={i === actif}
            className={`cursor-pointer px-2.5 py-1.5 text-sm ${i === actif ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
            // mousedown : le champ garde le focus, sinon sa perte (blur) fermerait la liste avant le clic.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choisir(p)}
          >
            <span className="block font-medium">{p.displayName}</span>
            {p.mail && <span className="block text-xs text-muted-foreground">{p.mail}</span>}
          </li>
        ))}
      </ul>
      <p role="status" className="min-h-4 text-xs text-muted-foreground">
        {!assez && saisie.trim() !== '' && `Saisissez ${TERME_MIN} caractères au moins.`}
        {enAttente && 'Recherche…'}
        {assez && !enAttente && !recherche.isError && resultats.length === 0 && recherche.isSuccess && 'Aucun résultat.'}
      </p>
      {assez && recherche.isError && <ApiErrorAlert error={recherche.error} />}
    </div>
  );
}
