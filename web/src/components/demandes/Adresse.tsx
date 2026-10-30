import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Adresse professionnelle sous le nom : une ligne, tronquée avec l'adresse entière en infobulle. */
export function Adresse({ upn, className = '' }: { upn: string | null; className?: string }) {
  if (!upn) return null;
  return (
    <span title={upn} className={`block truncate text-xs font-normal text-muted-foreground ${className}`}>
      {upn}
    </span>
  );
}

const DUREE_MESSAGE_MS = 2_000;

/** Copie l'adresse dans le presse-papiers. Le résultat est dit dans une zone `status` (le bouton change de libellé un instant). */
export function BoutonCopier({ upn, nom }: { upn: string; nom: string }) {
  const [etat, setEtat] = useState<'repos' | 'copie' | 'echec'>('repos');
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(minuteur.current), []);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(upn);
      setEtat('copie');
    } catch {
      // Presse-papiers indisponible (page non sécurisée, autorisation refusée) : l'adresse reste affichée, à copier à la main.
      setEtat('echec');
    }
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setEtat('repos'), DUREE_MESSAGE_MS);
  };
  return (
    <>
      <Button type="button" size="sm" variant="outline" aria-label={`Copier l’adresse e-mail de ${nom}`} onClick={() => void copier()}>
        {etat === 'copie' ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {etat === 'copie' ? 'Copié' : 'Copier'}
      </Button>
      <span role="status" className={etat === 'echec' ? 'text-xs text-destructive' : 'sr-only'}>
        {etat === 'copie' ? 'Adresse copiée' : etat === 'echec' ? 'Copie impossible : sélectionnez l’adresse' : ''}
      </span>
    </>
  );
}
