import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CheckIcon, InfoIcon, Loader2Icon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { ChoixManager } from '@/components/demandes/ChoixManager';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApiError, api } from '@/lib/api';
import type { Personne } from '@/lib/annuaire';
import { CHAMPS, LIMITES, estChamp, schemaDemande, type DemandeCreee, type DemandeEntree, type DemandeSortie } from '@/lib/demandeForm';
import { useDisponibilite, type Disponibilite } from '@/lib/disponibilite';
import { erreurEmail, proposerEmail } from '@/lib/email';
import { useMoi } from '@/lib/moi';
import { isSessionExpiredError } from '@/lib/session';
import { aujourdhui } from '@/lib/suivi';
import { TYPES_CONTRAT, TYPE_PAR_DEFAUT, type TypeContrat } from '@/lib/typeContrat';

interface Props {
  /** La demande a été créée (201) : la fenêtre se ferme et la page met la ligne en évidence. */
  onCree: (creee: DemandeCreee, valeurs: DemandeSortie) => void;
  onAnnuler: () => void;
  /** Un envoi est en cours : la fenêtre ne se ferme pas. */
  onEnvoi: (enCours: boolean) => void;
  /** Échap : la liste du responsable, si elle est ouverte, se ferme avant la fenêtre. */
  controleListe: { current: { ouverte: boolean; fermer: () => void } | null };
  /** Une demande a peut-être été créée malgré l'échec (502) : relire la liste. */
  onRelire: () => void;
}

/** Le domaine des adresses vient de GET /api/moi (déjà chargé par l'application) : sans lui, pas de formulaire. */
export function FormulaireDemande(props: Props) {
  const moi = useMoi();
  const domaine = moi.data?.domaine;
  if (!domaine) {
    return (
      <>
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle>Nouvelle demande</DialogTitle>
          <DialogDescription role="status">{moi.isError ? 'Impossible de charger le formulaire : rechargez la page.' : 'Chargement du formulaire…'}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-6 py-4">
          <Button type="button" variant="outline" onClick={props.onAnnuler}>
            Fermer
          </Button>
        </DialogFooter>
      </>
    );
  }
  return <Formulaire {...props} domaine={domaine} />;
}

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="mb-3 text-sm font-semibold">{titre}</legend>
      {children}
    </fieldset>
  );
}

const STATUT_EMAIL: Record<Disponibilite, { texte: string; classe: string; icone: ReactNode } | null> = {
  inconnue: null,
  verification: { texte: 'Vérification…', classe: 'text-muted-foreground', icone: <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" /> },
  disponible: { texte: 'Adresse disponible', classe: 'text-green-800', icone: <CheckIcon aria-hidden="true" className="size-3.5" /> },
  pris: { texte: 'Adresse déjà utilisée : modifiez-la.', classe: 'text-destructive', icone: <XIcon aria-hidden="true" className="size-3.5" /> },
  erreur: { texte: 'Vérification impossible pour le moment : le serveur revérifiera à l’envoi.', classe: 'text-muted-foreground', icone: <TriangleAlertIcon aria-hidden="true" className="size-3.5" /> },
};

/** « Nouvelle demande » : react-hook-form et zod, erreurs du serveur sous chaque champ. */
function Formulaire({ onCree, onAnnuler, onEnvoi, controleListe, onRelire, domaine }: Props & { domaine: string }) {
  const schema = useMemo(() => schemaDemande(domaine), [domaine]);
  const form = useForm<DemandeEntree, unknown, DemandeSortie>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    // Le focus du premier champ en erreur est posé ici (focaliser) : l’ordre de la page, y compris le type et le responsable.
    shouldFocusError: false,
    defaultValues: { prenom: '', nom: '', email: '', typeContrat: TYPE_PAR_DEFAUT, dateArrivee: '', poste: '', service: '', managerId: '' },
  });
  const { register, handleSubmit, setError, setValue, getValues, trigger, control, formState } = form;
  const { errors, isSubmitting } = formState;
  const [manager, setManager] = useState<Personne | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  // Vrai dès que la personne modifie l'adresse : on ne l'écrase plus. « Reproposer » revient à l'adresse proposée. Dans l'état du
  // composant, pas dans le formulaire : cet indicateur ne part pas au serveur.
  const [edite, setEdite] = useState(false);
  // Un envoi a été tenté : les erreurs se mettent à jour à chaque frappe, adresse proposée comprise. Un ref, pas l'état du formulaire :
  // le basculement de `isSubmitted` relancerait la proposition et effacerait l'erreur que le serveur vient de poser sur l'adresse.
  const tente = useRef(false);

  const [prenom, nom, email, typeContrat] = useWatch({ control, name: ['prenom', 'nom', 'email', 'typeContrat'] });
  const proposition = proposerEmail(prenom, nom, domaine);
  useEffect(() => {
    if (!edite) setValue('email', proposition, { shouldValidate: tente.current });
  }, [proposition, edite, setValue]);

  const adresse = useMemo(() => {
    const e = email.trim().toLowerCase();
    return erreurEmail(e, domaine) === null ? e : null;
  }, [email, domaine]);
  const dispo = useDisponibilite(adresse);

  /**
   * Champ qui n'est pas un `<input>` enregistré (type, responsable) : `setValue` ne le valide pas (la bibliothèque ne valide que les
   * champs enregistrés), donc l'erreur affichée (du serveur, ou d'un envoi à vide) resterait jusqu'au prochain envoi.
   */
  const poser = (champ: 'typeContrat' | 'managerId', valeur: string) => {
    setValue(champ, valeur, { shouldDirty: true, shouldTouch: true });
    void trigger(champ);
  };

  /**
   * Focus sur le premier champ en erreur dans l'ordre de la page (CHAMPS), y compris ceux que la bibliothèque ne sait pas atteindre
   * (type, responsable). Directement d'après les noms de champs, sans attendre l'affichage des erreurs : les champs existent déjà.
   */
  const focaliser = (champs: readonly string[]) => {
    const premier = CHAMPS.find((c) => champs.includes(c));
    if (!premier) return;
    document.getElementById(premier === 'typeContrat' ? `f-type-${getValues('typeContrat')}` : `f-${premier}`)?.focus();
  };

  // Le serveur n'est appelé qu'une fois par envoi : une création n'est jamais rejouée (doublon de compte).
  const creation = useMutation({ mutationFn: (v: DemandeSortie) => api.post<DemandeCreee>('/api/demandes', { ...v }) });
  const enCours = useRef(false);

  const soumettre = async (valeurs: DemandeSortie) => {
    if (enCours.current) return;
    tente.current = true;
    if (dispo === 'pris') {
      setError('email', { type: 'serveur', message: 'Cette adresse est déjà utilisée : modifiez-la.' });
      focaliser(['email']);
      return;
    }
    enCours.current = true;
    onEnvoi(true);
    setErreur(null);
    const enErreur: string[] = [];
    try {
      const res = await creation.mutateAsync(valeurs);
      if (res.kind === 'ok') onCree(res.data, valeurs);
    } catch (e) {
      if (isSessionExpiredError(e)) return; // l'application bascule sur l'écran de reconnexion
      if (e instanceof ApiError && e.kind === 'invalide' && e.details) {
        let inconnu = false;
        for (const [champ, message] of Object.entries(e.details)) {
          if (estChamp(champ)) {
            setError(champ, { type: 'serveur', message });
            enErreur.push(champ);
          } else inconnu = true;
        }
        if (inconnu) setErreur(e);
      } else {
        if (e instanceof ApiError && e.code === 'email_pris') {
          setError('email', { type: 'serveur', message: 'Cette adresse est déjà utilisée : modifiez-la.' });
          enErreur.push('email');
        } else if (e instanceof ApiError && e.code === 'licence_indisponible') {
          // Plus de champ licence : le type de contrat la détermine, c'est lui qui porte l'erreur.
          setError('typeContrat', { type: 'serveur', message: 'Aucune licence disponible pour ce type de contrat : libérez ou commandez une licence, puis renvoyez la demande.' });
          enErreur.push('typeContrat');
        } else {
          setErreur(e);
        }
        // Un 502 avec `id` : le compte existe peut-être. On relit la liste, on ne renvoie rien tout seul.
        if (e instanceof ApiError && e.kind === 'amont') onRelire();
      }
      focaliser(enErreur);
    } finally {
      enCours.current = false;
      onEnvoi(false);
    }
  };

  const bad = (c: keyof DemandeEntree) => errors[c] !== undefined;
  const desc = (c: keyof DemandeEntree) => (bad(c) ? `err-${c}` : undefined);
  const champTexte = (c: 'prenom' | 'nom' | 'poste' | 'service', libelle: string) => (
    <Field data-invalid={bad(c) || undefined}>
      <Label htmlFor={`f-${c}`}>{libelle}</Label>
      <Input id={`f-${c}`} maxLength={LIMITES[c] + 20} autoComplete="off" aria-invalid={bad(c) || undefined} aria-describedby={desc(c)} {...register(c)} />
      {errors[c]?.message && <FieldError id={`err-${c}`}>{errors[c]?.message}</FieldError>}
    </Field>
  );

  const statut = STATUT_EMAIL[dispo];
  const emailInvalide = bad('email') || dispo === 'pris';
  const peutReproposer = edite && proposition !== '' && email !== proposition;
  return (
    <form onSubmit={(e) => void handleSubmit(soumettre, (invalides) => {
        tente.current = true;
        focaliser(Object.keys(invalides));
      })(e)} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="px-6 pt-6 pr-12">
        <DialogTitle className="text-base">Nouvelle demande</DialogTitle>
        <DialogDescription>Le compte est créé désactivé. La direction valide, puis vous l’activez le jour de l’arrivée.</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
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

        <Section titre="Identité">
          <div className="grid gap-4 sm:grid-cols-2">
            {champTexte('prenom', 'Prénom')}
            {champTexte('nom', 'Nom')}
          </div>
          <Field data-invalid={emailInvalide || undefined}>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="f-email">Email pro</Label>
              {peutReproposer && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setEdite(false);
                    setValue('email', proposition, { shouldValidate: true, shouldDirty: true });
                  }}
                >
                  Reproposer
                  <span className="sr-only"> l’adresse d’après le prénom et le nom</span>
                </Button>
              )}
            </div>
            <Input
              id="f-email"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={emailInvalide || undefined}
              aria-describedby={[desc('email'), 'statut-email'].filter(Boolean).join(' ')}
              {...register('email', { onChange: () => setEdite(true) })}
            />
            {errors.email?.message && <FieldError id="err-email">{errors.email.message}</FieldError>}
            <p id="statut-email" role="status" className={`flex min-h-5 items-center gap-1.5 text-xs ${statut?.classe ?? 'text-muted-foreground'}`}>
              {statut ? (
                <>
                  {statut.icone}
                  {statut.texte}
                </>
              ) : (
                !edite && (
                  <>
                    <InfoIcon aria-hidden="true" className="size-3.5" />
                    Proposée d’après le prénom et le nom ; vous pouvez la modifier.
                  </>
                )
              )}
            </p>
          </Field>
        </Section>

        <Section titre="Contrat">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={bad('typeContrat') || undefined}>
              <span id="legende-type" className="text-sm leading-none font-medium">
                Type
              </span>
              <RadioGroup
                id="f-typeContrat"
                aria-labelledby="legende-type"
                aria-describedby={desc('typeContrat')}
                value={typeContrat}
                onValueChange={(v) => poser('typeContrat', v as TypeContrat)}
                className="grid-cols-2 gap-2"
              >
                {TYPES_CONTRAT.map((t) => (
                  <Label
                    key={t}
                    htmlFor={`f-type-${t}`}
                    className="cursor-pointer rounded-md border px-3 py-2 has-data-checked:border-primary has-data-checked:bg-muted/60 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                  >
                    <RadioGroupItem id={`f-type-${t}`} value={t} aria-invalid={bad('typeContrat') || undefined} />
                    {t}
                  </Label>
                ))}
              </RadioGroup>
              {errors.typeContrat?.message && <FieldError id="err-typeContrat">{errors.typeContrat.message}</FieldError>}
            </Field>
            <Field data-invalid={bad('dateArrivee') || undefined}>
              <Label htmlFor="f-dateArrivee">Date d’arrivée</Label>
              <Input id="f-dateArrivee" type="date" min={aujourdhui()} aria-invalid={bad('dateArrivee') || undefined} aria-describedby={desc('dateArrivee')} {...register('dateArrivee')} />
              {errors.dateArrivee?.message && <FieldError id="err-dateArrivee">{errors.dateArrivee.message}</FieldError>}
            </Field>
          </div>
        </Section>

        <Section titre="Poste">
          <div className="grid gap-4 sm:grid-cols-2">
            {champTexte('poste', 'Poste')}
            {champTexte('service', 'Service')}
          </div>
          <Field data-invalid={bad('managerId') || undefined}>
            <Label htmlFor="f-managerId">Responsable</Label>
            <ChoixManager
              id="f-managerId"
              choisi={manager}
              onChoisir={(p) => {
                setManager(p);
                poser('managerId', p?.id ?? '');
              }}
              invalide={bad('managerId')}
              decritPar={desc('managerId')}
              controleRef={controleListe}
            />
            {errors.managerId?.message && <FieldError id="err-managerId">{errors.managerId.message}</FieldError>}
          </Field>
        </Section>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onAnnuler}>
          Annuler
        </Button>
        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting && <Loader2Icon aria-hidden="true" className="animate-spin" />}
          {isSubmitting ? 'Création…' : 'Créer la demande'}
        </Button>
      </DialogFooter>
    </form>
  );
}
