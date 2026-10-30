import type { ReactNode } from 'react';
import { Link } from 'react-router';
import logo from '@/assets/telesio.svg';

/**
 * En-tête fixe. Fond sombre : le texte du logo (#F0F5FF, couleurs d'origine) n'est lisible que sur fond foncé.
 * `children` : menu utilisateur (ou son squelette), à droite.
 */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          to="/"
          aria-label="Telesio Onboarding, accueil"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-foreground"
        >
          <img src={logo} alt="" width={120} height={47} className="h-9 w-auto sm:h-10" />
        </Link>
        {children}
      </div>
    </header>
  );
}
