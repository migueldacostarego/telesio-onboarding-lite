export interface Screen {
  /** Segment de l'URL sous /app. */
  path: string;
  titre: string;
  role: string;
  description: string;
  /** Page actuelle (hors React), en service jusqu'à la migration de l'écran. */
  actuelle: string;
}

export const SCREENS: readonly Screen[] = [
  {
    path: 'demande',
    titre: 'Demande d’onboarding',
    role: 'RH',
    description: 'Saisir une arrivée : identité, poste, manager, licence.',
    actuelle: '/demande',
  },
  {
    path: 'activation',
    titre: 'Activation des comptes',
    role: 'RH',
    description: 'Activer un compte le jour J, remettre le mot de passe temporaire, suivre l’onboarding.',
    actuelle: '/activation',
  },
  {
    path: 'direction',
    titre: 'Demandes en attente',
    role: 'Direction',
    description: 'Valider ou refuser les demandes d’onboarding.',
    actuelle: '/direction',
  },
];
