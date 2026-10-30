import { CheckIcon, KeyRoundIcon, PowerIcon, RotateCcwIcon, XIcon, type LucideIcon } from 'lucide-react';
import type { ActionNom } from '@/lib/actions';

export interface Bouton {
  /** Entrée de `actions` (API) qui le propose. */
  api: string;
  action: ActionNom;
  libelle: string;
  /** Dit aux lecteurs d'écran ce qui tourne ; le libellé du bouton ne change pas (sa largeur non plus), le spinner remplace l'icône. */
  attente: string;
  /** Nom accessible : « Valider la demande de … ». */
  nom: (nom: string) => string;
  variante: 'default' | 'destructive' | 'outline';
  Icone: LucideIcon;
}

/** Ordre d'affichage. Un bouton n'existe que si l'API le propose pour la personne connectée (`actions`). */
export const BOUTONS: Bouton[] = [
  { api: 'approuver', action: 'valider', libelle: 'Valider', attente: 'Validation…', nom: (n) => `Valider la demande de ${n}`, variante: 'default', Icone: CheckIcon },
  { api: 'refuser', action: 'refuser', libelle: 'Refuser', attente: 'Refus…', nom: (n) => `Refuser la demande de ${n}`, variante: 'destructive', Icone: XIcon },
  // Compte Validé dont le dossier SharePoint manque (après un 502) : recrée le dossier seulement, sans refaire la licence ni le groupe.
  { api: 'reprendre', action: 'reprendre', libelle: 'Réessayer', attente: 'Nouvelle tentative…', nom: (n) => `Réessayer la création du dossier de ${n}`, variante: 'outline', Icone: RotateCcwIcon },
  { api: 'activer', action: 'activer', libelle: 'Activer', attente: 'Activation…', nom: (n) => `Activer le compte de ${n}`, variante: 'default', Icone: PowerIcon },
  { api: 'regenerer', action: 'regenerer', libelle: 'Régénérer', attente: 'Régénération…', nom: (n) => `Régénérer le mot de passe de ${n}`, variante: 'outline', Icone: KeyRoundIcon },
];

