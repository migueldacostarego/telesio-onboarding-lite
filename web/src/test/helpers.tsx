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
  const fn = vi.fn((url: string, init?: RequestInit) => {
    void init;
    return Promise.resolve(handler(String(url)));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Fausse API : /api/moi et /api/suivi. `suivi` : une réponse ({ demandes, tronque }), ou une fonction (une Response, éventuellement
 * en attente), appelée à chaque lecture. Par défaut : aucune demande.
 */
export function mockApi(o: { moi?: object | (() => Response | Promise<Response>); suivi?: object | (() => Response | Promise<Response>) } = {}) {
  const reponse = (v: object | (() => Response | Promise<Response>) | undefined, defaut: object) => (typeof v === 'function' ? v() : reply(200, v ?? defaut));
  return mockFetch((url) => {
    if (url === '/api/moi') return reponse(o.moi, CAMILLE);
    if (url === '/api/suivi') return reponse(o.suivi, { demandes: [], tronque: false });
    return reply(404, { error: 'Introuvable' });
  });
}

/** Nombre de lectures de GET /api/suivi faites jusqu'ici. */
export const lecturesSuivi = (fn: ReturnType<typeof mockFetch>): number => fn.mock.calls.filter((c) => c[0] === '/api/suivi').length;

/** matchMedia : `bureau` vrai à partir de 768 px (tableau), faux en dessous (cartes). */
export function stubBureau(bureau: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: bureau, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
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
