import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { AppHeader } from '@/components/AppHeader';
import { UserMenu, UserMenuSkeleton } from '@/components/UserMenu';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMoi } from '@/lib/moi';
import { useSessionExpired } from '@/lib/session';
import { Demandes } from '@/pages/Demandes';
import { SessionExpired } from '@/pages/SessionExpired';
import { Unauthorized } from '@/pages/Unauthorized';

function Frame({ menu, children }: { menu?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-foreground focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Aller au contenu
      </a>
      <AppHeader>{menu}</AppHeader>
      <main id="contenu" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 focus:outline-none">
        {children}
      </main>
    </div>
  );
}

/** Même hauteur que le titre de page : le contenu ne saute pas quand il remplace le squelette. */
function PageSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Chargement…</span>
      <Skeleton className="h-8 w-48 bg-foreground/10" />
    </div>
  );
}

export function App() {
  const expired = useSessionExpired();
  const moi = useMoi(!expired);

  if (expired) {
    return (
      <Frame>
        <SessionExpired />
      </Frame>
    );
  }
  if (moi.isPending) {
    return (
      <Frame menu={<UserMenuSkeleton />}>
        <PageSkeleton />
      </Frame>
    );
  }
  if (moi.isError) {
    return (
      <Frame>
        <div className="mx-auto max-w-lg space-y-4">
          <ApiErrorAlert error={moi.error} />
          <Button variant="outline" onClick={() => void moi.refetch()} disabled={moi.isFetching}>
            Réessayer
          </Button>
        </div>
      </Frame>
    );
  }
  if (!moi.data.droits.acces) {
    return (
      <Frame menu={<UserMenu user={moi.data} />}>
        <Unauthorized />
      </Frame>
    );
  }
  return (
    <Frame menu={<UserMenu user={moi.data} />}>
      <Routes>
        <Route index element={<Demandes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Frame>
  );
}
