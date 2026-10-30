import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '@/App';
import { createQueryClient } from '@/lib/query';

export const DISPONIBILITE = '/api/annuaire/disponibilite';

export const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Remplace fetch : `handler` reçoit l'URL et répond (promesse en attente possible pour un chargement). */
export function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(String(url), init)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Fausse API : /api/moi et /api/suivi. `suivi` : une réponse ({ demandes, tronque }), ou une fonction (une Response, éventuellement
 * en attente), appelée à chaque lecture. Par défaut : aucune demande.
 */
export function mockApi(
  o: {
    moi?: object | (() => Response | Promise<Response>);
    suivi?: object | (() => Response | Promise<Response>);
    /** Autres lectures (GET) : annuaire, disponibilité… Sans réponse, 404. */
    lire?: (url: string) => Response | Promise<Response> | undefined;
    /** Vérification d'une adresse (POST /api/annuaire/disponibilite) : l'adresse demandée ; sans elle, toujours libre. Ce n'est pas une écriture (`ecritures` l'ignore). */
    disponibilite?: (email: string) => Response | Promise<Response>;
    /** Écritures (POST) : l'adresse et le corps JSON ; sans elle, 404. */
    ecrire?: (url: string, corps: Record<string, unknown>) => Response | Promise<Response>;
  } = {},
) {
  const reponse = (v: object | (() => Response | Promise<Response>) | undefined, defaut: object) => (typeof v === 'function' ? v() : reply(200, v ?? defaut));
  return mockFetch((url, init) => {
    if (init?.method === 'POST' && url === DISPONIBILITE) {
      const { email } = JSON.parse(String(init.body ?? '{}')) as { email: string };
      return o.disponibilite ? o.disponibilite(email) : reply(200, { disponible: true });
    }
    if (init?.method === 'POST' && o.ecrire) return o.ecrire(url, JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>);
    if (url === '/api/moi') return reponse(o.moi, CAMILLE);
    if (url === '/api/suivi') return reponse(o.suivi, { demandes: [], tronque: false });
    const autre = init?.method === 'POST' ? undefined : o.lire?.(url);
    if (autre) return autre;
    return reply(404, { error: 'Introuvable' });
  });
}

/** Écritures (POST) faites jusqu'ici : adresse et corps JSON (hors vérifications d'adresse : `verifications`). */
export const ecritures = (fn: ReturnType<typeof mockFetch>): { url: string; corps: unknown }[] =>
  fn.mock.calls.filter((c) => c[1]?.method === 'POST' && c[0] !== DISPONIBILITE).map((c) => ({ url: String(c[0]), corps: JSON.parse(String(c[1]?.body ?? '{}')) as unknown }));

/** Adresses dont la disponibilité a été demandée jusqu'ici, dans l'ordre. */
export const verifications = (fn: ReturnType<typeof mockFetch>): string[] =>
  fn.mock.calls.filter((c) => c[0] === DISPONIBILITE).map((c) => (JSON.parse(String(c[1]?.body ?? '{}')) as { email: string }).email);

/** Nombre de lectures de GET /api/suivi faites jusqu'ici. */
export const lecturesSuivi = (fn: ReturnType<typeof mockFetch>): number => fn.mock.calls.filter((c) => c[0] === '/api/suivi').length;

/** matchMedia : `bureau` vrai à partir de 768 px (tableau), faux en dessous (cartes). */
export function stubBureau(bureau: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: bureau, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

export const AUCUN_DROIT = { acces: false, creer: false, approuver: false, activer: false };
export const DROITS_RH = { acces: true, creer: true, approuver: false, activer: true };
export const DROITS_DIRECTION = { acces: true, creer: true, approuver: true, activer: false };

export const CAMILLE = { nom: 'Camille Exemple', email: 'camille@exemple.test', roles: ['RH'], droits: DROITS_RH, domaine: 'exemple.test' };

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
