import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LimiteErreur } from '@/components/LimiteErreur';

function Casse(): never {
  throw new Error('détail interne avec une donnée : camille@exemple.test');
}

describe('LimiteErreur', () => {
  // React journalise lui-même l'exception rattrapée : on la masque pour garder la sortie des tests lisible.
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('rend les enfants tant qu’il n’y a pas d’erreur', () => {
    render(
      <LimiteErreur message="Impossible">
        <p>contenu</p>
      </LimiteErreur>,
    );
    expect(screen.getByText('contenu')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('remplace seulement la zone en erreur par un message et un bouton de rechargement, sans afficher le message de l’exception', () => {
    render(
      <>
        <p>reste affiché</p>
        <LimiteErreur message="Impossible de charger le formulaire.">
          <Casse />
        </LimiteErreur>
      </>,
    );
    expect(screen.getByText('reste affiché')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger le formulaire.');
    expect(document.body.textContent).not.toMatch(/camille|détail interne/);
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeInTheDocument();
  });

  it('le bouton recharge la page', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(
      <LimiteErreur message="Impossible">
        <Casse />
      </LimiteErreur>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Recharger la page' }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
