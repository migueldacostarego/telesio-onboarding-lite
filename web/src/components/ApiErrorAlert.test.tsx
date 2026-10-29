import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiErrorAlert } from '@/components/ApiErrorAlert';
import { ApiError } from '@/lib/api';

describe('ApiErrorAlert', () => {
  it('affiche le titre du type d’erreur, le message du back et l’étape', () => {
    const error = new ApiError({ status: 502, kind: 'amont', message: 'Le dossier n’a pas pu être créé', etape: 'dossier_sharepoint' });
    render(<ApiErrorAlert error={error} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Une étape a échoué')).toBeInTheDocument();
    expect(screen.getByText('Le dossier n’a pas pu être créé')).toBeInTheDocument();
    expect(screen.getByText('Étape : dossier_sharepoint')).toBeInTheDocument();
  });

  it('liste les erreurs par champ', () => {
    const error = new ApiError({ status: 400, kind: 'invalide', message: 'Entrée invalide', details: { nom: 'requis' } });
    render(<ApiErrorAlert error={error} />);
    expect(screen.getByText('nom : requis')).toBeInTheDocument();
  });

  it('une erreur inconnue donne un message générique, sans son contenu', () => {
    render(<ApiErrorAlert error={new Error('détail interne')} />);
    expect(screen.getByText('Erreur inattendue')).toBeInTheDocument();
    expect(screen.queryByText('détail interne')).not.toBeInTheDocument();
  });
});
