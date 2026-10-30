import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reply, stubBureau } from '@/test/helpers';
import { ELOISE, HUGO, actif, avancer, enAttente, monter, tempsSimule } from '@/test/demandes';

tempsSimule();

const rien = () => reply(200, {});
const UPN_ELOISE = 'compte.eloise@exemple.test';

afterEach(() => vi.restoreAllMocks());

describe('adresse professionnelle (UPN)', () => {
  it('tableau : sous le nom, tronquée avec l’adresse entière en infobulle', async () => {
    stubBureau(true);
    monter({ demandes: [enAttente(ELOISE), actif(HUGO)], ecrire: rien });
    const ligne = await screen.findByRole('row', { name: /Éloïse Dupont/ });
    const adresse = within(ligne).getByText(UPN_ELOISE);
    expect(adresse).toHaveAttribute('title', UPN_ELOISE);
    expect(adresse).toHaveClass('truncate');
    expect(within(screen.getByRole('row', { name: /Hugo Lambert/ })).getByText('compte.hugo@exemple.test')).toBeInTheDocument();
  });

  it('cartes mobiles : sous le nom', async () => {
    stubBureau(false);
    monter({ demandes: [enAttente(ELOISE)], ecrire: rien });
    const carte = (await screen.findByText(UPN_ELOISE)).closest('li') as HTMLElement;
    expect(within(carte).getByText('Éloïse Dupont')).toBeInTheDocument();
    expect(screen.getByText(UPN_ELOISE)).toHaveAttribute('title', UPN_ELOISE);
  });

  it('adresse absente : rien d’affiché sous le nom, « Non renseigné » dans le détail, pas de bouton Copier', async () => {
    stubBureau(true);
    const { user } = monter({ demandes: [enAttente(ELOISE, { upn: null })], ecrire: rien });
    await screen.findByText('Éloïse Dupont');
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Voir le détail de la demande de Éloïse Dupont/ }));
    const identite = await screen.findByRole('region', { name: 'Identité' });
    expect(within(identite).getByText('E-mail').nextElementSibling).toHaveTextContent('Non renseigné');
    expect(within(identite).queryByRole('button', { name: /Copier/ })).not.toBeInTheDocument();
  });

  it('détail : l’adresse et un bouton Copier qui la met dans le presse-papiers, confirmé puis rétabli', async () => {
    stubBureau(true);
    const { user } = monter({ demandes: [enAttente(ELOISE)], ecrire: rien, chemin: `/demandes/${ELOISE.id}` });
    const panneau = await screen.findByRole('region', { name: 'Identité' });
    expect(within(panneau).getByText(UPN_ELOISE)).toBeInTheDocument();

    const bouton = within(panneau).getByRole('button', { name: 'Copier l’adresse e-mail de Éloïse Dupont' });
    expect(bouton).toHaveTextContent('Copier');
    await user.click(bouton);
    expect(await navigator.clipboard.readText()).toBe(UPN_ELOISE);
    expect(bouton).toHaveTextContent('Copié');
    expect(within(panneau).getByText('Adresse copiée')).toBeInTheDocument();

    await avancer(2_100);
    expect(bouton).toHaveTextContent('Copier');
    expect(within(panneau).queryByText('Adresse copiée')).not.toBeInTheDocument();
  });

  it('presse-papiers refusé : message dans le panneau, l’adresse reste affichée, rien n’est cassé', async () => {
    stubBureau(true);
    const { user } = monter({ demandes: [enAttente(ELOISE)], ecrire: rien, chemin: `/demandes/${ELOISE.id}` });
    const panneau = await screen.findByRole('region', { name: 'Identité' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('refusé'));
    await user.click(within(panneau).getByRole('button', { name: /Copier l’adresse/ }));
    await waitFor(() => expect(within(panneau).getByText(/Copie impossible/)).toBeInTheDocument());
    expect(within(panneau).getByText(UPN_ELOISE)).toBeInTheDocument();
    expect(within(panneau).getByRole('button', { name: /Copier l’adresse/ })).toHaveTextContent('Copier');
  });

  it('l’adresse n’est ni dans l’adresse de la page ni dans le stockage du navigateur', async () => {
    stubBureau(true);
    const { user } = monter({ demandes: [enAttente(ELOISE)], ecrire: rien });
    await screen.findByText('Éloïse Dupont');
    await user.click(screen.getByRole('link', { name: /Voir le détail de la demande de Éloïse Dupont/ }));
    await user.click(await screen.findByRole('button', { name: /Copier l’adresse/ }));
    expect(window.location.pathname).toBe(`/demandes/${ELOISE.id}`);
    expect(window.location.href).not.toContain('exemple.test');
    expect(window.location.search + window.location.hash).toBe('');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('exemple.test');
  });
});
