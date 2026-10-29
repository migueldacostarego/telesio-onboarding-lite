import { QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import type { Demande } from '@/lib/suivi';
import { Demandes } from '@/pages/Demandes';
import { mockApi, reply } from '@/test/helpers';

/** À appeler en tête d'un fichier de test : temps simulé (le temps réel continue de couler), date figée au 28 octobre 2026. */
export function tempsSimule() {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 28, 12, 0, 0) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

export const ELOISE = { id: 'id-eloise', nom: 'Éloïse Dupont' };
export const HUGO = { id: 'id-hugo', nom: 'Hugo Lambert' };
export const enAttente = (p: { id: string; nom: string }, o: Partial<Demande> = {}): Demande => ({
  ...p,
  poste: 'Comptable',
  service: 'Finance',
  dateArrivee: '2026-11-03',
  statut: 'EnAttente',
  etape: 1,
  actions: ['approuver', 'refuser'],
  ...o,
});
export const valide = (p: { id: string; nom: string }, o: Partial<Demande> = {}): Demande => enAttente(p, { statut: 'Validé', etape: 2, actions: [], ...o });
export const actif = (p: { id: string; nom: string }, o: Partial<Demande> = {}): Demande =>
  enAttente(p, { statut: 'Actif', etape: 3, actions: ['regenerer'], onboarding: { motDePasse: false, authenticator: false, termine: false }, ...o });

/** Fausse API avec une liste que les tests modifient : `suivi` relit toujours `etat.demandes`. */
export function monter(o: { demandes?: Demande[]; ecrire: (url: string, corps: Record<string, unknown>) => Response | Promise<Response>; surSession?: () => void }) {
  const etat = { demandes: o.demandes ?? [enAttente(ELOISE), enAttente(HUGO)] };
  const fetchMock = mockApi({ suivi: () => reply(200, { demandes: etat.demandes, tronque: false }), ecrire: o.ecrire });
  const client = createQueryClient(o.surSession);
  const vue = render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Demandes />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  return { etat, fetchMock, client, user, ...vue };
}

export const avancer = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
