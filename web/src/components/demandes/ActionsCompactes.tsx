import { EllipsisIcon, EyeIcon, Loader2Icon } from 'lucide-react';
import { Link } from 'react-router';
import type { PropsActions } from '@/components/demandes/ActionsLigne';
import { BOUTONS } from '@/components/demandes/boutons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { verrouille } from '@/lib/actions';

/** L'action qui fait avancer la demande, par ordre de priorité : valider, puis activer, puis refaire le dossier. Les autres vont dans le menu « … ». */
const PRINCIPALES = ['approuver', 'activer', 'reprendre'] as const;

/**
 * Actions d'une ligne : **une action principale** en bouton (celle qui fait avancer la demande) et, dans le menu « … », le détail et
 * les actions secondaires (Refuser, Réessayer le dossier, Régénérer). Seulement ce que l'API propose pour la personne connectée
 * (`actions`). Tant que quelque chose tourne pour la ligne, rien n'y est cliquable : le spinner est sur le bouton de l'action en
 * cours (ou sur « … » quand c'est une action du menu). Le bouton garde sa largeur : rien ne bouge pendant l'action.
 */
export function ActionsCompactes({ demande, etat, onAction }: Omit<PropsActions, 'surUneLigne'>) {
  const proposes = BOUTONS.filter((b) => demande.actions.includes(b.api));
  const principale = PRINCIPALES.map((api) => proposes.find((b) => b.api === api)).find((b) => b !== undefined);
  const secondaires = proposes.filter((b) => b !== principale);
  const occupee = verrouille(etat);
  const enCours = etat?.phase === 'en_cours' ? etat.action : undefined;
  const principaleEnCours = principale !== undefined && enCours === principale.action;
  return (
    <div className="flex items-center justify-end gap-1.5">
      {principale && (
        <Button
          size="sm"
          variant="default"
          className="min-w-[5.5rem] justify-center"
          disabled={occupee}
          aria-busy={principaleEnCours}
          aria-label={principale.nom(demande.nom)}
          onClick={() => onAction(principale.action)}
        >
          {principaleEnCours ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <principale.Icone aria-hidden="true" />}
          {principale.libelle}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" disabled={occupee} aria-busy={enCours !== undefined && !principaleEnCours} aria-label={`Autres actions pour ${demande.nom}`}>
            {enCours !== undefined && !principaleEnCours ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <EllipsisIcon aria-hidden="true" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem asChild>
            <Link to={`/demandes/${demande.id}`}>
              <EyeIcon aria-hidden="true" />
              Voir le détail
            </Link>
          </DropdownMenuItem>
          {secondaires.length > 0 && <DropdownMenuSeparator />}
          {secondaires.map((b) => (
            <DropdownMenuItem key={b.action} variant={b.action === 'refuser' ? 'destructive' : 'default'} aria-label={b.nom(demande.nom)} onSelect={() => onAction(b.action)}>
              <b.Icone aria-hidden="true" />
              {b.libelle}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {enCours !== undefined && (
        <span role="status" className="sr-only">
          {BOUTONS.find((b) => b.action === enCours)?.attente}
        </span>
      )}
    </div>
  );
}
