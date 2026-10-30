import { CircleCheckIcon, CircleDotIcon, CircleIcon, CircleXIcon, type LucideIcon } from 'lucide-react';
import { LIBELLES_JALON, type EtatJalon, type Jalon } from '@/lib/chronologie';
import { formatInstant } from '@/lib/dates';

// Vert, bleu, rouge, gris : l'état est aussi dit en toutes lettres, la couleur ne porte rien à elle seule.
const STYLES: Record<EtatJalon, { Icone: LucideIcon; couleur: string }> = {
  fait: { Icone: CircleCheckIcon, couleur: 'text-green-700 dark:text-green-400' },
  en_cours: { Icone: CircleDotIcon, couleur: 'text-blue-700 dark:text-blue-400' },
  echec: { Icone: CircleXIcon, couleur: 'text-destructive' },
  a_venir: { Icone: CircleIcon, couleur: 'text-muted-foreground' },
};

/** Quand et par qui, sur une ligne : « 30 oct. 2026 à 14:05, par Camille » ; une étape faite sans date dit « date non enregistrée ». */
function QuandQui({ jalon }: { jalon: Jalon }) {
  if (jalon.le === undefined && jalon.par === undefined) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {jalon.le ? <time dateTime={jalon.le}>{formatInstant(jalon.le)}</time> : jalon.le === null ? 'Date non enregistrée' : null}
      {jalon.par && <>{jalon.le !== undefined ? ', par ' : 'Par '}{jalon.par}</>}
    </p>
  );
}

/**
 * Chronologie verticale : une ligne par étape, ses sous-étapes (régénération, Authenticator, mot de passe) en retrait sous « Compte
 * activé ». Une `ol` : c'est bien une suite dans le temps. Les heures sont celles de Paris.
 */
export function Chronologie({ jalons }: { jalons: readonly Jalon[] }) {
  return (
    <ol className="relative">
      {jalons.map((j, i) => {
        const { Icone, couleur } = STYLES[j.etat];
        const dernier = i === jalons.length - 1;
        return (
          <li key={j.cle} data-jalon={j.cle} data-etat={j.etat} aria-current={j.etat === 'en_cours' ? 'step' : undefined} className={`relative flex gap-3 ${j.sous ? 'ml-8' : ''} ${dernier ? '' : 'pb-5'}`}>
            {/* Fil qui relie les puces ; la dernière n'en a pas. */}
            {!dernier && <span aria-hidden="true" className="absolute top-6 bottom-0 left-2.5 w-px bg-border" />}
            <Icone aria-hidden="true" className={`relative mt-0.5 size-5 shrink-0 bg-background ${couleur}`} />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">
                {j.titre} <span className={`font-normal ${couleur}`}>: {LIBELLES_JALON[j.etat]}</span>
              </p>
              <QuandQui jalon={j} />
              {j.detail && <p className="text-sm text-muted-foreground">{j.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
