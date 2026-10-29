import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '@/App';
import { createQueryClient } from '@/lib/query';

export const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Remplace fetch : `handler` reçoit l'URL et répond (promesse en attente possible pour un chargement). */
export function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const fn = vi.fn((url: string) => Promise.resolve(handler(String(url))));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const AUCUN_DROIT = { acces: false, creer: false, approuver: false, activer: false };
export const DROITS_RH = { acces: true, creer: true, approuver: false, activer: true };
export const DROITS_DIRECTION = { acces: true, creer: true, approuver: true, activer: false };

export const CAMILLE = { nom: 'Camille Exemple', email: 'camille@exemple.test', roles: ['RH'], droits: DROITS_RH };

export function renderApp(path = '/', client: QueryClient = createQueryClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
