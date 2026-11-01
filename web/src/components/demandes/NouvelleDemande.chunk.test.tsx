import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NouvelleDemande } from '@/components/demandes/NouvelleDemande';

// Le chunk du formulaire est introuvable (redéploiement : les anciens fichiers hachés répondent 404) : l'import dynamique est rejeté.
vi.mock('@/components/demandes/FormulaireDemande', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

describe('Nouvelle demande : chunk du formulaire introuvable', () => {
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('affiche un message et un bouton de rechargement dans la fenêtre, jamais une page blanche', async () => {
    render(<NouvelleDemande onCree={() => {}} onRelire={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle demande' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger le formulaire');
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeInTheDocument();
    // La fenêtre reste montée : l'exception n'a pas emporté la racine.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
