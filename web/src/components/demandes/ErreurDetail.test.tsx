import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErreurDetail } from '@/components/demandes/ErreurDetail';
import { ApiError } from '@/lib/api';

describe('ErreurDetail', () => {
  it('404 : « Demande introuvable », ni alerte ni bouton', () => {
    render(<ErreurDetail error={new ApiError({ status: 404, kind: 'introuvable', message: 'Demande introuvable' })} enCours={false} onReessayer={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Demande introuvable' })).toBeInTheDocument();
    expect(screen.getByText(/elle a peut-être été refusée/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('autre erreur de l’API : son message et « Réessayer », qui relit', async () => {
    const onReessayer = vi.fn();
    render(<ErreurDetail error={new ApiError({ status: 503, kind: 'indisponible', message: 'Activation non configurée' })} enCours={false} onReessayer={onReessayer} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Activation non configurée');
    expect(screen.queryByRole('heading', { name: 'Demande introuvable' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onReessayer).toHaveBeenCalledOnce();
  });

  it('erreur qui n’est pas de l’API (réseau, exception) : message générique et « Réessayer »', () => {
    render(<ErreurDetail error={new Error('détail interne')} enCours={false} onReessayer={() => {}} />);
    expect(screen.getByText('Erreur inattendue')).toBeInTheDocument();
    expect(screen.queryByText('détail interne')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeEnabled();
  });

  it('relecture en cours : « Réessayer » est désactivé', () => {
    render(<ErreurDetail error={new Error('x')} enCours onReessayer={() => {}} />);
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDisabled();
  });

  it('une erreur d’un autre statut que 404 n’est pas « introuvable »', () => {
    render(<ErreurDetail error={new ApiError({ status: 403, kind: 'non_autorise', message: 'Accès refusé' })} enCours={false} onReessayer={() => {}} />);
    expect(screen.queryByRole('heading', { name: 'Demande introuvable' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
