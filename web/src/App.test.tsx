import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';
import { createQueryClient } from '@/lib/query';

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('écran d’accueil', () => {
  it('affiche l’en-tête et un lien par écran à venir', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Telesio Onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Telesio' })).toHaveAttribute('src', expect.stringContaining('telesio'));
    expect(screen.getByRole('link', { name: /Ouvrir.*Demande d’onboarding/ })).toHaveAttribute('href', '/demande');
    expect(screen.getByRole('link', { name: /Ouvrir.*Activation des comptes/ })).toHaveAttribute('href', '/activation');
    expect(screen.getByRole('link', { name: /Ouvrir.*Demandes en attente/ })).toHaveAttribute('href', '/direction');
  });

  it('un écran à venir renvoie vers la page actuelle', () => {
    renderAt('/direction');
    expect(screen.getByText('À venir')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Utiliser la page actuelle' })).toHaveAttribute('href', '/direction');
  });

  it('une adresse inconnue ne renvoie vers aucune page actuelle', () => {
    renderAt('/nimporte-quoi');
    expect(screen.getByText('Écran inconnu')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Utiliser la page actuelle' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' })).toBeInTheDocument();
  });
});
