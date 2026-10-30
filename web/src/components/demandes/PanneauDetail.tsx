import { CircleCheckIcon, CircleDotIcon, CircleIcon, CircleXIcon, type LucideIcon } from 'lucide-react';
import { ActionsLigne, MessageLigne } from '@/components/demandes/ActionsLigne';
import { BoutonCopier } from '@/components/demandes/Adresse';
import { StatutBadge } from '@/components/demandes/StatutBadge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { ActionNom, EtatLigne } from '@/lib/actions';
import { LIBELLES_ETAT, etapesDe, type EtatEtape } from '@/lib/etapes';
import { formatArrivee, type Demande } from '@/lib/suivi';

interface Props {
  /** La demande ouverte, ou `undefined` : fermé (aussi quand elle disparaît de la liste). */
  demande: Demande | undefined;
  etat: EtatLigne | undefined;
  onAction: (action: ActionNom) => void;
  onFermerMessage: () => void;
  onFermer: () => void;
}

// Vert, bleu, gris, rouge : l'état est aussi dit en toutes lettres, la couleur ne porte rien à elle seule.
const STYLES: Record<EtatEtape, { Icone: LucideIcon; icone: string; texte: string }> = {
  reussie: { Icone: CircleCheckIcon, icone: 'text-green-700 dark:text-green-400', texte: 'text-green-700 dark:text-green-400' },
  en_cours: { Icone: CircleDotIcon, icone: 'text-blue-700 dark:text-blue-400', texte: 'text-blue-700 dark:text-blue-400' },
  echec: { Icone: CircleXIcon, icone: 'text-destructive', texte: 'text-destructive' },
  a_venir: { Icone: CircleIcon, icone: 'text-muted-foreground', texte: 'text-muted-foreground' },
};

/** Détail d'une demande, à droite : ses quatre étapes et, pour un compte Actif, l'état d'onboarding. Les actions de la ligne y sont aussi. */
export function PanneauDetail({ demande, etat, onAction, onFermerMessage, onFermer }: Props) {
  return (
    <Sheet open={demande !== undefined} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">{demande && <Contenu demande={demande} etat={etat} onAction={onAction} onFermerMessage={onFermerMessage} />}</SheetContent>
    </Sheet>
  );
}

function Contenu({ demande, etat, onAction, onFermerMessage }: Omit<Props, 'demande' | 'onFermer'> & { demande: Demande }) {
  const etapes = etapesDe(demande, etat);
  const infos = [
    ['Poste', demande.poste],
    ['Service', demande.service],
    ['Arrivée', demande.dateArrivee ? formatArrivee(demande.dateArrivee) : null],
  ] as const;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-8 text-base">{demande.nom}</SheetTitle>
        <SheetDescription asChild>
          <div className="flex items-center gap-2">
            <StatutBadge statut={demande.statut} />
            <span>Étape {demande.etape} sur 4</span>
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <div className="contents">
            <dt className="text-muted-foreground">E-mail</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2">
              {demande.upn ? (
                <>
                  <span className="min-w-0 break-all">{demande.upn}</span>
                  <BoutonCopier upn={demande.upn} nom={demande.nom} />
                </>
              ) : (
                <span className="text-muted-foreground">Non renseigné</span>
              )}
            </dd>
          </div>
          {infos.map(([libelle, valeur]) => (
            <div key={libelle} className="contents">
              <dt className="text-muted-foreground">{libelle}</dt>
              <dd>{valeur ?? <span className="text-muted-foreground">Non renseigné</span>}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="etapes-titre" className="space-y-3">
          <h2 id="etapes-titre" className="text-sm font-medium">
            Étapes
          </h2>
          <ol className="space-y-4">
            {etapes.map((e) => {
              const { Icone, icone, texte } = STYLES[e.etat];
              return (
                <li key={e.cle} data-etape={e.cle} data-etat={e.etat} className="flex gap-3" aria-current={e.etat === 'en_cours' ? 'step' : undefined}>
                  <Icone aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${icone}`} />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">
                      {e.libelle} <span className={`font-normal ${texte}`}>: {LIBELLES_ETAT[e.etat]}</span>
                    </p>
                    {e.detail && <p className="text-sm text-muted-foreground">{e.detail}</p>}
                    {e.sousEtats && (
                      <ul className="space-y-1 text-sm" aria-label="Onboarding de l’arrivant">
                        {e.sousEtats.map((s) => (
                          <li key={s.libelle} data-fait={s.fait} className="flex items-center gap-1.5">
                            {s.fait ? <CircleCheckIcon aria-hidden="true" className="size-4 text-green-700 dark:text-green-400" /> : <CircleIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
                            <span>{s.libelle}</span>
                            <span className="text-muted-foreground">: {s.fait ? 'fait' : 'à faire'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-label="Actions" className="space-y-3">
          <ActionsLigne demande={demande} etat={etat} onAction={onAction} />
          <MessageLigne etat={etat} onFermer={onFermerMessage} />
        </section>
      </div>
    </>
  );
}
