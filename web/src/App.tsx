import { Link, Route, Routes } from 'react-router';
import logo from '@/assets/telesio.svg';
import { ComingSoon } from '@/pages/ComingSoon';
import { Home } from '@/pages/Home';

export function App() {
  return (
    <div className="min-h-svh">
      {/* Fond sombre : le logo (couleurs d'origine, texte #F0F5FF) n'est lisible que sur fond foncé. */}
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="Telesio" width={120} height={47} className="h-10 w-auto" />{' '}
            <span className="text-lg font-semibold tracking-tight">Onboarding</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route index element={<Home />} />
          <Route path=":screen" element={<ComingSoon />} />
        </Routes>
      </main>
    </div>
  );
}
