import { InfoIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DemandeEntree, DemandeSortie } from '@/lib/demandeForm';
import { proposerTrigramme } from '@/lib/trigramme';

interface Props {
  form: UseFormReturn<DemandeEntree, unknown, DemandeSortie>;
  /** Un envoi a été tenté : la proposition est revalidée à chaque frappe (comme l'adresse). */
  tente: { readonly current: boolean };
}

/**
 * Trigramme de « Nouvelle demande » : proposé d'après le prénom et le nom tant que la personne ne le modifie pas, comme l'adresse ;
 * « Reproposer » revient à la proposition. Le serveur refuse (409) un trigramme déjà porté par un compte : l'erreur s'affiche ici.
 */
export function ChampTrigramme({ form, tente }: Props) {
  const { register, setValue, control, formState } = form;
  const [prenom, nom, trigramme] = useWatch({ control, name: ['prenom', 'nom', 'trigramme'] });
  // Vrai dès que la personne modifie le trigramme : on ne l'écrase plus. État du composant, il ne part pas au serveur.
  const [edite, setEdite] = useState(false);
  const proposition = proposerTrigramme(prenom, nom);
  useEffect(() => {
    if (!edite) setValue('trigramme', proposition, { shouldValidate: tente.current });
  }, [proposition, edite, setValue, tente]);

  const erreur = formState.errors.trigramme?.message;
  const peutReproposer = edite && proposition !== '' && trigramme.trim().toUpperCase() !== proposition;
  return (
    <Field data-invalid={erreur ? true : undefined}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="f-trigramme">Trigramme</Label>
        {peutReproposer && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setEdite(false);
              setValue('trigramme', proposition, { shouldValidate: true, shouldDirty: true });
            }}
          >
            Reproposer
            <span className="sr-only"> le trigramme d’après le prénom et le nom</span>
          </Button>
        )}
      </div>
      {/* Le Field étire ses enfants (*:w-full) : une largeur maximale garde le champ à la taille de trois lettres. */}
      <Input
        id="f-trigramme"
        type="text"
        maxLength={3}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="max-w-24 uppercase"
        aria-invalid={erreur ? true : undefined}
        aria-describedby={[erreur ? 'err-trigramme' : undefined, 'aide-trigramme'].filter(Boolean).join(' ')}
        {...register('trigramme', { onChange: () => setEdite(true) })}
      />
      {erreur && <FieldError id="err-trigramme">{erreur}</FieldError>}
      <p id="aide-trigramme" className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
        {!edite && proposition !== '' && (
          <>
            <InfoIcon aria-hidden="true" className="size-3.5" />
            Proposé d’après le prénom et le nom ; vous pouvez le modifier.
          </>
        )}
      </p>
    </Field>
  );
}
