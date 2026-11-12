import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { RELECTURE_SYNCHRO_MS, useSuivi } from '@/lib/suivi';
import { attendre } from '@/lib/synchro';
import { ELOISE, avancer, enAttente, tempsSimule, valide } from '@/test/demandes';
import { lecturesSuivi, mockApi, reply } from '@/test/helpers';

// Audit F-08 : la relecture de synchronisation ne doit jamais annuler la lecture en cours.
tempsSimule();

describe('useSuivi pendant une synchronisation', () => {
  it('API plus lente que 5 s : la lecture aboutit, aucune autre n’est lancée pendant qu’elle court', async () => {
    let lenteur = 0;
    let demandes = [enAttente(ELOISE)];
    const fetchMock = mockApi({
      suivi: () => {
        const r = reply(200, { demandes, tronque: false });
        return lenteur === 0 ? r : new Promise<Response>((ok) => setTimeout(() => ok(r), lenteur));
      },
    });
    const client = createQueryClient();
    const { result } = renderHook(() => useSuivi(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.data).toBeDefined());

    lenteur = 8_000; // plus que RELECTURE_SYNCHRO_MS
    expect(lenteur).toBeGreaterThan(RELECTURE_SYNCHRO_MS);
    act(() => attendre(client, valide(ELOISE, { actions: [] })));
    demandes = [valide(ELOISE, { actions: ['activer'] })]; // l'API rendra la ligne au bon statut
    const avant = lecturesSuivi(fetchMock);

    await avancer(RELECTURE_SYNCHRO_MS + 100); // une lecture part
    expect(lecturesSuivi(fetchMock)).toBe(avant + 1);
    await avancer(RELECTURE_SYNCHRO_MS); // l'intervalle sonne pendant qu'elle court : il s'y greffe
    expect(lecturesSuivi(fetchMock)).toBe(avant + 1);
    await avancer(lenteur);
    await waitFor(() => expect(result.current.data?.demandes[0]).toMatchObject({ statut: 'Validé', actions: ['activer'] }));
    expect(result.current.data?.demandes[0]?.synchro).toBeUndefined();
  });
});
