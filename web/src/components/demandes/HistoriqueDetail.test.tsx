import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoriqueDetail } from '@/components/demandes/HistoriqueDetail';
import type { Jalon } from '@/lib/chronologie';

const jalons: Jalon[] = [
  { cle: 'creee', titre: 'Demande créée', etat: 'fait', le: '2026-10-20T08:15:00Z', par: 'Camille RH' },
  { cle: 'validee', titre: 'Demande validée', etat: 'en_cours' },
];
const BANDEAU = /n’est pas encore enregistré sur cet environnement/;

describe('HistoriqueDetail', () => {
  it('titre, fuseau et une ligne par jalon, sans bandeau quand l’historique est enregistré', () => {
    render(<HistoriqueDetail jalons={jalons} enregistre />);
    const section = screen.getByRole('region', { name: 'Historique' });
    expect(section).toHaveTextContent('Heures de Paris.');
    expect([...section.querySelectorAll('[data-jalon]')].map((j) => `${j.getAttribute('data-jalon')}:${j.getAttribute('data-etat')}`)).toEqual(['creee:fait', 'validee:en_cours']);
    expect(screen.queryByText(BANDEAU)).not.toBeInTheDocument();
  });

  it('historique non enregistré sur l’environnement : un bandeau le dit', () => {
    render(<HistoriqueDetail jalons={jalons} enregistre={false} />);
    expect(screen.getByText(BANDEAU)).toBeInTheDocument();
    expect(screen.getByText(/seule la création est connue/)).toBeInTheDocument();
  });
});
