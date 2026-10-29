import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { ChoixManager } from '@/components/demandes/ChoixManager';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ApiError, api } from '@/lib/api';
import type { Personne } from '@/lib/annuaire';
import { LIMITES, estChamp, schemaDemande, type DemandeCreee, type DemandeEntree, type DemandeSortie } from '@/lib/demandeForm';
import { useLicences } from '@/lib/licences';
import { isSessionExpiredError } from '@/lib/session';
import { aujourdhui } from '@/lib/suivi';

interface Props {
  /** La demande a été créée (201) : le panneau se ferme et la page met la ligne en évidence. */
  onCree: (creee: DemandeCreee, valeurs: DemandeSortie) => void;
  onAnnuler: () => void;
  /** Un envoi est en cours : le panneau ne se ferme pas. */
  onEnvoi: (enCours: boolean) => void;
  /** Échap : la liste du responsable, si elle est ouverte, se ferme avant le panneau. */
  controleListe: { current: { ouverte: boolean; fermer: () => void } | null };
  /** Une demande a peut-être été créée malgré l'échec (502) : relire la liste. */
  onRelire: () => void;
}

const classeSelect =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30';

/** « Nouvelle demande » : react-hook-form et zod, erreurs du serveur sous chaque champ. */
export function FormulaireDemande({ onCree, onAnnuler, onEnvoi, controleListe, onRelire }: Props) {
  const queryClient = useQueryClient();
  const form = useForm<DemandeEntree, unknown, DemandeSortie>({
    resolver: zodResolver(schemaDemande),
    mode: 'onTouched',
    defaultValues: { prenom: '', nom: '', poste: '', service: '', dateArrivee: '', managerId: '', licence: '' },
  });
  const { register, handleSubmit, setError, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const [manager, setManager] = useState<Personne | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const licences = useLicences(true);
  // Le serveur n'est appelé qu'une fois par envoi : une création n'est jamais rejouée (doublon de compte).
  const creation = useMutation({ mutationFn: (v: DemandeSortie) => api.post<DemandeCreee>('/api/demandes', { ...v }) });
  const enCours = useRef(false);

  const soumettre = async (valeurs: DemandeSortie) => {
    if (enCours.current) return;
    enCours.current = true;
    onEnvoi(true);
    setErreur(null);
    try {
      const res = await creation.mutateAsync(valeurs);
      if (res.kind === 'ok') onCree(res.data, valeurs);
    } catch (e) {
      if (isSessionExpiredError(e)) return; // l'application bascule sur l'écran de reconnexion
      if (e instanceof ApiError && e.kind === 'invalide' && e.details) {
        let inconnu = false;
        for (const [champ, message] of Object.entries(e.details)) {
          if (estChamp(champ)) setError(champ, { type: 'serveur', message });
          else inconnu = true;
        }
        if (inconnu) setErreur(e);
      } else {
        if (e instanceof ApiError && e.code === 'licence_indisponible') {
          setError('licence', { type: 'serveur', message: 'Plus aucune licence disponible pour celle-ci : choisissez-en une autre.' });
          void queryClient.invalidateQueries({ queryKey: ['licences'] });
        }
        setErreur(e);
        // Un 502 avec `id` : le compte existe peut-être. On relit la liste, on ne renvoie rien tout seul.
        if (e instanceof ApiError && e.kind === 'amont') onRelire();
      }
    } finally {
      enCours.current = false;
      onEnvoi(false);
    }
  };

  const bad = (c: keyof DemandeEntree) => errors[c] !== undefined;
  const desc = (c: keyof DemandeEntree) => (bad(c) ? `err-${c}` : undefined);
  const champTexte = (c: 'prenom' | 'nom' | 'poste' | 'service', libelle: string, autoComplete?: string) => (
    <Field data-invalid={bad(c) || undefined}>
      <FieldLabel htmlFor={`f-${c}`}>{libelle}</FieldLabel>
      <Input id={`f-${c}`} maxLength={LIMITES[c] + 20} autoComplete={autoComplete ?? 'off'} aria-invalid={bad(c) || undefined} aria-describedby={desc(c)} {...register(c)} />
      {errors[c]?.message && <FieldError id={`err-${c}`}>{errors[c]?.message}</FieldError>}
    </Field>
  );

  const aucuneLicence = licences.isSuccess && licences.data.length === 0;
  return (
    <form onSubmit={(e) => void handleSubmit(soumettre)(e)} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle>Nouvelle demande</SheetTitle>
        <SheetDescription>Le compte est créé désactivé. La direction valide, puis vous l’activez le jour de l’arrivée.</SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {erreur !== null && (
          <div className="space-y-2">
            <ApiErrorAlert error={erreur} />
            {erreur instanceof ApiError && erreur.kind === 'amont' && (
              <Alert>
                <AlertTitle>Ne renvoyez pas la demande</AlertTitle>
                <AlertDescription>Le compte a peut-être été créé malgré l’échec : vérifiez la liste avant de recommencer, pour éviter un doublon.</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        <FieldGroup>
          {champTexte('prenom', 'Prénom', 'off')}
          {champTexte('nom', 'Nom')}
          {champTexte('poste', 'Poste')}
          {champTexte('service', 'Service')}
          <Field data-invalid={bad('dateArrivee') || undefined}>
            <FieldLabel htmlFor="f-dateArrivee">Date d’arrivée</FieldLabel>
            <Input id="f-dateArrivee" type="date" min={aujourdhui()} aria-invalid={bad('dateArrivee') || undefined} aria-describedby={desc('dateArrivee')} {...register('dateArrivee')} />
            {errors.dateArrivee?.message && <FieldError id="err-dateArrivee">{errors.dateArrivee.message}</FieldError>}
          </Field>
          <Field data-invalid={bad('managerId') || undefined}>
            <FieldLabel htmlFor="f-managerId">Responsable</FieldLabel>
            <ChoixManager
              id="f-managerId"
              choisi={manager}
              onChoisir={(p) => {
                setManager(p);
                setValue('managerId', p?.id ?? '', { shouldValidate: true, shouldTouch: true });
              }}
              invalide={bad('managerId')}
              decritPar={desc('managerId')}
              controleRef={controleListe}
            />
            {errors.managerId?.message && <FieldError id="err-managerId">{errors.managerId.message}</FieldError>}
          </Field>
          <Field data-invalid={bad('licence') || undefined}>
            <FieldLabel htmlFor="f-licence">Licence</FieldLabel>
            {licences.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">Chargement des licences…</p>
            ) : licences.isError ? (
              <div className="space-y-2">
                <ApiErrorAlert error={licences.error} />
                <Button type="button" variant="outline" size="sm" onClick={() => void licences.refetch()} disabled={licences.isFetching}>
                  Réessayer
                </Button>
              </div>
            ) : (
              <select id="f-licence" className={classeSelect} aria-invalid={bad('licence') || undefined} aria-describedby={desc('licence')} {...register('licence')}>
                <option value="">Choisir une licence</option>
                {licences.data.map((l) => (
                  <option key={l.skuId} value={l.skuId} disabled={l.disponibles <= 0}>
                    {l.libelle} : {l.disponibles > 0 ? `${l.disponibles} disponible${l.disponibles > 1 ? 's' : ''}` : 'aucune disponible'}
                  </option>
                ))}
              </select>
            )}
            {aucuneLicence && <FieldDescription>Aucune licence n’est proposée.</FieldDescription>}
            {errors.licence?.message && <FieldError id="err-licence">{errors.licence.message}</FieldError>}
          </Field>
        </FieldGroup>
      </div>

      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onAnnuler}>
          Annuler
        </Button>
        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting && <Loader2Icon aria-hidden="true" className="animate-spin" />}
          {isSubmitting ? 'Création…' : 'Créer la demande'}
        </Button>
      </SheetFooter>
    </form>
  );
}
