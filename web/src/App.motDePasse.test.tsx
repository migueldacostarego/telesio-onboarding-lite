import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOI_KEY } from '@/lib/moi';
import { SUIVI_KEY } from '@/lib/suivi';
import { fusionner } from '@/lib/synchro';
import { HUGO, ELOISE, enAttente, valide } from '@/test/demandes';
import { CAMILLE, mockApi, renderApp, reply } from '@/test/helpers';

// Le sort de la boîte du mot de passe temporaire avec l'application complète (App, et non les seules routes) : relecture de
// /api/moi en échec, session expirée, exception de rendu d'une page.

const exploser = vi.hoisted(() => ({ actif: false }));
vi.mock('@/components/demandes/Compteurs', async (original) => {
  const mod = await original<typeof import('@/components/demandes/Compteurs')>();
  return {
    ...mod,
    Compteurs: (props: ComponentProps<typeof mod.Compteurs>) => {
      if (exploser.actif) throw new Error('rendu impossible');
      return <mod.Compteurs {...props} />;
    },
  };
});

afterEach(() => {
  exploser.actif = false;
  vi.restoreAllMocks();
});

const MOT_DE_PASSE = 'Kp7m-Xq4r-Tz9w-Hb3n';
const BOITE = `Mot de passe temporaire de ${ELOISE.nom}`;

/** TanStack prévient ses observateurs au tour suivant : on lui laisse le temps de rendre. */
const laisserRendre = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

/** Application chargée, compte activé : la boîte affiche le mot de passe. `moi` et `demandes` restent modifiables par le test. */
async function motDePasseAffiche() {
  const api = { moi: () => reply(200, CAMILLE), demandes: [valide(ELOISE, { actions: ['activer'] })] };
  const fetchMock = mockApi({
    moi: () => api.moi(),
    suivi: () => reply(200, { demandes: api.demandes, tronque: false }),
    ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration: false, motDePasseTemporaire: MOT_DE_PASSE }),
  });
  const user = userEvent.setup();
  const vue = renderApp();
  await user.click(await screen.findByRole('button', { name: `Activer le compte de ${ELOISE.nom}` }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
  expect(await screen.findByRole('dialog', { name: BOITE })).toHaveTextContent(MOT_DE_PASSE);
  return { ...vue, api, fetchMock };
}

describe('boîte du mot de passe temporaire, application complète', () => {
  it('relecture de /api/moi en échec (données déjà là) : l’application reste montée, la boîte et le mot de passe aussi', async () => {
    const { client, api } = await motDePasseAffiche();
    api.moi = () => reply(500, { error: 'Erreur interne' });
    await act(async () => {
      await client.refetchQueries({ queryKey: MOI_KEY });
    });
    expect(client.getQueryState(MOI_KEY)?.status).toBe('error');
    await laisserRendre();
    expect(screen.getByRole('dialog', { name: BOITE })).toHaveTextContent(MOT_DE_PASSE);
    // La page est derrière la boîte modale (masquée aux technologies d'assistance) : lue dans le DOM.
    expect(document.querySelector('h1')).toHaveTextContent('Demandes');
    expect(screen.queryByRole('button', { name: 'Réessayer', hidden: true })).not.toBeInTheDocument();
  });

  it('session expirée pendant l’affichage (401 sur /api/moi) : écran de reconnexion, le mot de passe n’est plus nulle part', async () => {
    const { client, api } = await motDePasseAffiche();
    api.moi = () => reply(401, { error: 'Authentification requise' });
    await act(async () => {
      await client.refetchQueries({ queryKey: MOI_KEY });
    });
    expect(await screen.findByRole('heading', { name: 'Votre session a expiré' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.documentElement.outerHTML).not.toContain(MOT_DE_PASSE);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state))).not.toContain(MOT_DE_PASSE);
    // L'activation avait gardé la ligne en synchronisation (nom, adresse) : purgée avec le reste.
    expect(fusionner(client, [])).toEqual([]);
  });

  it('exception de rendu de la page : la limite remplace la page, la boîte du mot de passe reste affichée', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, api } = await motDePasseAffiche();
    exploser.actif = true;
    api.demandes = [...api.demandes, enAttente(HUGO)];
    await act(async () => {
      await client.refetchQueries({ queryKey: SUIVI_KEY });
    });
    expect(await screen.findByText('Une erreur est survenue')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: BOITE })).toHaveTextContent(MOT_DE_PASSE);
  });
});
