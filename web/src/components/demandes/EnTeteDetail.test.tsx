import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnTeteDetail } from '@/components/demandes/EnTeteDetail';
import type { DemandeDetail } from '@/lib/detail';
import { ELOISE, detailDe, valide } from '@/test/demandes';

// Date figée au 28 octobre 2026 (midi) : « arrivée le … (demain) » dépend du jour, pas des minuteries.
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-28T11:00:00Z') /* 12 h à Paris */ }));
afterEach(() => vi.useRealTimers());

const detail = (surcharge: Partial<DemandeDetail> = {}) => detailDe(valide(ELOISE), surcharge);
const sousTitre = () => screen.getByText(/Comptable|Finance|Poste non renseigné/).closest('p') as HTMLElement;

describe('EnTeteDetail', () => {
  it('nom en titre, statut passé en propriété (pas celui du détail), type de contrat, poste et arrivée', () => {
    render(<EnTeteDetail d={detail({ typeContrat: 'Contractor', dateArrivee: '2026-11-03' })} statut="Actif" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Éloïse Dupont');
    expect(document.querySelector('[data-slot="statut"]')).toHaveAttribute('data-statut', 'Actif');
    expect(screen.getByText('Contractor')).toBeInTheDocument();
    expect(sousTitre()).toHaveTextContent('Comptable · Finance · arrivée le 3 nov. 2026 (dans 6 j)');
  });

  it.each([
    ['2026-10-28', '(aujourd’hui)'],
    ['2026-10-29', '(demain)'],
    ['2026-10-27', '(hier)'],
    ['2026-10-20', '(il y a 8 j)'],
  ])('arrivée le %s : %s', (dateArrivee, relatif) => {
    render(<EnTeteDetail d={detail({ dateArrivee })} statut="Validé" />);
    expect(sousTitre()).toHaveTextContent(relatif);
  });

  it('sans date d’arrivée : pas de mention d’arrivée', () => {
    render(<EnTeteDetail d={detail({ dateArrivee: null })} statut="Validé" />);
    expect(sousTitre()).toHaveTextContent(/^Comptable · Finance$/);
  });

  it('date illisible : l’arrivée est dite sans durée relative', () => {
    render(<EnTeteDetail d={detail({ dateArrivee: 'pas une date' })} statut="Validé" />);
    expect(sousTitre()).toHaveTextContent('arrivée le Non renseignée');
    expect(sousTitre()).not.toHaveTextContent('(');
  });

  it('ni poste ni service : « Poste non renseigné »', () => {
    render(<EnTeteDetail d={detail({ poste: null, service: null })} statut="Validé" />);
    expect(sousTitre()).toHaveTextContent('Poste non renseigné');
  });

  it('boutons d’action : rendus dans un bloc de l’en-tête ; sans eux, aucun bloc', () => {
    const { container, rerender } = render(
      <EnTeteDetail d={detail()} statut="Validé">
        <button type="button">Activer</button>
      </EnTeteDetail>,
    );
    expect(container.querySelector('header > div.space-y-2')).toContainElement(screen.getByRole('button', { name: 'Activer' }));
    rerender(<EnTeteDetail d={detail()} statut="Validé">{undefined}</EnTeteDetail>);
    expect(container.querySelector('header > div.space-y-2')).toBeNull();
    rerender(<EnTeteDetail d={detail()} statut="Validé">{false}</EnTeteDetail>);
    expect(container.querySelector('header > div.space-y-2')).toBeNull();
  });
});
