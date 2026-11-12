import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMILLE, mockApi, renderApp } from '@/test/helpers';

// Audit F-09 : une exception dans une boîte de dialogue ou dans l'en-tête ne donne plus une page blanche.
const casse = vi.hoisted(() => ({ boite: false, entete: false }));
vi.mock('@/components/demandes/DialogueRefus', async (original) => {
  const vrai = await original<typeof import('@/components/demandes/DialogueRefus')>();
  return {
    DialogueRefus: (props: Parameters<typeof vrai.DialogueRefus>[0]) => {
      if (casse.boite) throw new Error('boîte cassée');
      return vrai.DialogueRefus(props);
    },
  };
});
vi.mock('@/components/AppHeader', async (original) => {
  const vrai = await original<typeof import('@/components/AppHeader')>();
  return {
    AppHeader: (props: Parameters<typeof vrai.AppHeader>[0]) => {
      if (casse.entete) throw new Error('en-tête cassé');
      return vrai.AppHeader(props);
    },
  };
});

beforeEach(() => {
  casse.boite = false;
  casse.entete = false;
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React journalise l'exception rattrapée
});

describe('limites d’erreur (F-09)', () => {
  it('une boîte de dialogue qui lève : la page reste, un message remplace la boîte', async () => {
    casse.boite = true;
    mockApi({});
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Demandes' })).toBeInTheDocument();
    expect(screen.getByText(/Cette fenêtre n’a pas pu s’afficher/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Menu utilisateur/ })).toBeInTheDocument();
  });

  it('l’en-tête qui lève : la page reste, un message remplace l’en-tête', async () => {
    casse.entete = true;
    mockApi({});
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Demandes' })).toBeInTheDocument();
    expect(screen.getAllByText(/L’en-tête n’a pas pu s’afficher/).length).toBeGreaterThan(0);
  });

  it.each([['absents', undefined], ['pas un tableau', 'RH'], ['mêlés', ['RH', 3, null]]])('/api/moi avec des rôles %s : l’application s’affiche, menu compris', async (_cas, roles) => {
    mockApi({ moi: { ...CAMILLE, roles } });
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Demandes' })).toBeInTheDocument();
    const menu = screen.getByRole('button', { name: /Menu utilisateur/ });
    expect(menu).toBeInTheDocument();
    expect(menu.getAttribute('aria-label')).not.toMatch(/3|null/);
  });
});
