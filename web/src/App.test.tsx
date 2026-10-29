import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { LOGOUT_URL } from '@/lib/auth';
import { AUCUN_DROIT, CAMILLE, DROITS_DIRECTION, DROITS_RH, mockFetch, renderApp, reply } from '@/test/helpers';

/** Plus aucune donnée en cache (une requête désactivée, sans données, peut être recréée par son observateur). */
const sansDonnees = (client: QueryClient) => client.getQueryCache().getAll().every((q) => q.state.data === undefined);
const connecte = (moi: object = CAMILLE) => mockFetch(() => reply(200, moi));

describe('chargement de /api/moi', () => {
  it('affiche des squelettes (en-tête et page), jamais un écran vide, puis les remplace sans texte intermédiaire', async () => {
    let finir!: (r: Response) => void;
    mockFetch(() => new Promise<Response>((resolve) => (finir = resolve)));
    renderApp();

    expect(screen.getByText('Chargement de votre profil…')).toBeInTheDocument();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText(/erreur|expiré|non autorisé/i)).not.toBeInTheDocument();

    await act(async () => finir(reply(200, CAMILLE)));
    expect(await screen.findByRole('heading', { level: 1, name: 'Demandes' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('interroge /api/moi une seule fois, en lecture', async () => {
    const fetchMock = connecte();
    renderApp();
    await screen.findByRole('heading', { name: 'Demandes' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/moi');
  });
});

describe('page Demandes', () => {
  it('est vide avec son titre, sans les cartes d’accueil', async () => {
    connecte();
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Demandes' })).toBeInTheDocument();
    expect(screen.getByRole('main').children).toHaveLength(1);
    expect(screen.queryByText(/Ouvrir/)).not.toBeInTheDocument();
    expect(screen.queryByText(/à venir/i)).not.toBeInTheDocument();
  });

  it('une adresse inconnue ramène sur Demandes', async () => {
    connecte();
    renderApp('/nimporte-quoi');
    expect(await screen.findByRole('heading', { name: 'Demandes' })).toBeInTheDocument();
  });
});

describe('en-tête et menu utilisateur', () => {
  it('logo à gauche (lien d’accueil nommé), repères de page et lien d’évitement', async () => {
    connecte();
    renderApp();
    await screen.findByRole('heading', { name: 'Demandes' });
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Telesio Onboarding, accueil' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenu');
    expect(screen.getByRole('link', { name: 'Aller au contenu' })).toHaveAttribute('href', '#contenu');
  });

  it('bouton nommé avec le nom et le rôle, initiales décoratives, badge du rôle', async () => {
    connecte();
    renderApp();
    const bouton = await screen.findByRole('button', { name: 'Menu utilisateur, Camille Exemple, RH' });
    expect(bouton).toHaveTextContent('CE');
    expect(bouton).toHaveTextContent('Camille Exemple');
    expect(bouton).toHaveTextContent('RH');
    expect(bouton.querySelector('[data-slot="avatar"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('plusieurs rôles : un badge par rôle', async () => {
    connecte({ ...CAMILLE, roles: ['Direction', 'RH'], droits: { ...DROITS_DIRECTION, activer: true } });
    renderApp();
    const bouton = await screen.findByRole('button', { name: 'Menu utilisateur, Camille Exemple, Direction, RH' });
    expect(within(bouton).getByText('Direction')).toBeInTheDocument();
    expect(within(bouton).getByText('RH')).toBeInTheDocument();
  });

  it('au clavier : Tab jusqu’au bouton, Entrée ouvre la liste (email, Se déconnecter), Échap la ferme et rend le focus', async () => {
    connecte();
    const user = userEvent.setup();
    renderApp();
    const bouton = await screen.findByRole('button', { name: /Menu utilisateur/ });

    await user.tab(); // lien d'évitement
    expect(screen.getByRole('link', { name: 'Aller au contenu' })).toHaveFocus();
    await user.tab(); // logo
    expect(screen.getByRole('link', { name: 'Telesio Onboarding, accueil' })).toHaveFocus();
    await user.tab();
    expect(bouton).toHaveFocus();

    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('camille@exemple.test')).toBeInTheDocument();
    expect(within(menu).getByText('Camille Exemple')).toBeInTheDocument();
    const quitter = within(menu).getByRole('menuitem', { name: 'Se déconnecter' });
    expect(quitter).toHaveAttribute('href', LOGOUT_URL);
    expect(quitter).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(bouton).toHaveFocus();
  });

  it('le menu s’ouvre aussi à la souris', async () => {
    connecte();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: /Menu utilisateur/ }));
    expect(await screen.findByRole('menuitem', { name: 'Se déconnecter' })).toBeInTheDocument();
  });

  it('sans nom dans le jeton, l’email tient lieu de nom', async () => {
    connecte({ nom: '', email: 'camille@exemple.test', roles: ['RH'], droits: DROITS_RH });
    renderApp();
    expect(await screen.findByRole('button', { name: 'Menu utilisateur, camille@exemple.test, RH' })).toHaveTextContent('C');
  });
});

describe('sans aucun droit (droits.acces faux)', () => {
  it('page « Accès non autorisé » avec Se déconnecter, sans la page Demandes', async () => {
    connecte({ nom: 'Camille Exemple', email: 'camille@exemple.test', roles: [], droits: AUCUN_DROIT });
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Accès non autorisé' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Se déconnecter' })).toHaveAttribute('href', LOGOUT_URL);
    expect(screen.queryByRole('heading', { name: 'Demandes' })).not.toBeInTheDocument();
  });

  it('le badge affiche toujours le rôle, même sans droit', async () => {
    connecte({ nom: 'Alex Exemple', email: null, roles: ['Autre'], droits: AUCUN_DROIT });
    renderApp();
    const bouton = await screen.findByRole('button', { name: 'Menu utilisateur, Alex Exemple, Autre' });
    expect(within(bouton).getByText('Autre')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Accès non autorisé' })).toBeInTheDocument();
  });

  it('le texte de la page ne cite aucun nom de rôle', async () => {
    connecte({ nom: 'Camille Exemple', email: null, roles: [], droits: AUCUN_DROIT });
    renderApp();
    await screen.findByRole('heading', { name: 'Accès non autorisé' });
    expect(screen.getByRole('main')).not.toHaveTextContent(/\bRH\b|Direction/);
  });
});

describe('l’interface ne décide que d’après les droits', () => {
  it('un rôle nommé « RH » sans droit n’ouvre rien', async () => {
    connecte({ nom: 'Camille Exemple', email: null, roles: ['RH'], droits: AUCUN_DROIT });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Accès non autorisé' })).toBeInTheDocument();
  });

  it('un rôle au nom quelconque avec des droits donne accès (noms configurables côté serveur), et le badge le dit', async () => {
    connecte({ nom: 'Camille Exemple', email: null, roles: ['RessourcesHumaines'], droits: DROITS_RH });
    renderApp();
    const bouton = await screen.findByRole('button', { name: 'Menu utilisateur, Camille Exemple, RessourcesHumaines' });
    expect(within(bouton).getByText('RessourcesHumaines')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Demandes' })).toBeInTheDocument();
  });

  it('n’importe lequel des droits suffit à entrer : Direction seule', async () => {
    connecte({ nom: 'Camille Exemple', email: null, roles: ['Direction'], droits: DROITS_DIRECTION });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Demandes' })).toBeInTheDocument();
  });
});

describe('session expirée', () => {
  it('401 sur /api/moi : message, bouton Se reconnecter, cache vidé', async () => {
    mockFetch(() => reply(401, { error: 'Authentification requise' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { client } = renderApp();

    expect(await screen.findByRole('heading', { name: 'Votre session a expiré' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(sansDonnees(client)).toBe(true));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Se reconnecter' }));
    expect(assign).toHaveBeenCalledWith('/app/');
  });

  it('401 sur n’importe quel autre appel, session pourtant ouverte : bascule sur l’écran et vide le cache', async () => {
    mockFetch((url) => (url === '/api/moi' ? reply(200, CAMILLE) : reply(401, { error: 'Authentification requise' })));
    const { client } = renderApp();
    await screen.findByRole('heading', { name: 'Demandes' });
    await client.prefetchQuery({ queryKey: ['donnees', 'nominatives'], queryFn: () => Promise.resolve({ nom: 'Camille' }) });
    expect(client.getQueryCache().getAll()).toHaveLength(2);

    await act(async () => {
      await client.fetchQuery({ queryKey: ['autre'], queryFn: () => api.get('/api/demandes') }).catch(() => undefined);
    });
    expect(await screen.findByRole('heading', { name: 'Votre session a expiré' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Demandes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Menu utilisateur/ })).not.toBeInTheDocument();
    await waitFor(() => expect(sansDonnees(client)).toBe(true));
    expect(client.getQueryData(['donnees', 'nominatives'])).toBeUndefined();
    expect(client.getQueryData(['moi'])).toBeUndefined();
  });

  it('une réponse hors JSON (redirection vers la connexion) expire aussi la session', async () => {
    mockFetch(() => new Response('<html>Connexion</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Votre session a expiré' })).toBeInTheDocument();
  });

  it('un 403 n’est pas une session expirée', async () => {
    mockFetch(() => reply(403, { error: 'Accès refusé' }));
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Accès refusé');
    expect(screen.queryByText('Votre session a expiré')).not.toBeInTheDocument();
  });
});

describe('erreur de chargement de /api/moi', () => {
  it('message dans l’écran et bouton Réessayer qui relit /api/moi', async () => {
    let appels = 0;
    const fetchMock = mockFetch(() => (++appels === 1 ? reply(500, { error: 'Erreur interne' }) : reply(200, CAMILLE)));
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur interne');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'Demandes' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
