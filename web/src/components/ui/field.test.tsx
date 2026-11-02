import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FieldError } from '@/components/ui/field';

describe('FieldError', () => {
  describe('children', () => {
    it('affiche les children dans une alerte', () => {
      render(<FieldError>Champ requis</FieldError>);
      expect(screen.getByRole('alert')).toHaveTextContent('Champ requis');
    });

    it('les children sont prioritaires sur errors', () => {
      render(<FieldError errors={[{ message: 'ignorée' }]}>Message libre</FieldError>);
      expect(screen.getByRole('alert')).toHaveTextContent('Message libre');
      expect(screen.queryByText('ignorée')).not.toBeInTheDocument();
    });

    it('des children vides laissent la main à errors', () => {
      render(<FieldError errors={[{ message: 'Valeur invalide' }]}>{null}</FieldError>);
      expect(screen.getByRole('alert')).toHaveTextContent('Valeur invalide');
    });
  });

  describe('sans contenu', () => {
    it('ne rend rien sans children ni errors', () => {
      const { container } = render(<FieldError />);
      expect(container).toBeEmptyDOMElement();
    });

    it('ne rend rien avec un tableau d’erreurs vide', () => {
      const { container } = render(<FieldError errors={[]} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('ne rend rien si la seule erreur est undefined', () => {
      const { container } = render(<FieldError errors={[undefined]} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('ne rend rien si la seule erreur n’a pas de message', () => {
      const { container } = render(<FieldError errors={[{}]} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('ne rend rien si la seule erreur a un message vide', () => {
      const { container } = render(<FieldError errors={[{ message: '' }]} />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('une erreur', () => {
    it('affiche le message en texte simple, sans liste', () => {
      render(<FieldError errors={[{ message: 'Email invalide' }]} />);
      const alerte = screen.getByRole('alert');
      expect(alerte).toHaveTextContent('Email invalide');
      expect(within(alerte).queryByRole('list')).not.toBeInTheDocument();
    });

    it('des doublons se ramènent à une seule erreur, sans liste', () => {
      render(
        <FieldError errors={[{ message: 'Email invalide' }, { message: 'Email invalide' }, { message: 'Email invalide' }]} />,
      );
      const alerte = screen.getByRole('alert');
      expect(alerte.textContent).toBe('Email invalide');
      expect(within(alerte).queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('plusieurs erreurs', () => {
    it('affiche une liste, un élément par message', () => {
      render(<FieldError errors={[{ message: 'Trop court' }, { message: 'Doit contenir un chiffre' }]} />);
      const items = within(screen.getByRole('list')).getAllByRole('listitem');
      expect(items.map((item) => item.textContent)).toEqual(['Trop court', 'Doit contenir un chiffre']);
    });

    it('dédoublonne les messages identiques et garde l’ordre d’apparition', () => {
      render(
        <FieldError
          errors={[{ message: 'Trop court' }, { message: 'Sans chiffre' }, { message: 'Trop court' }, { message: 'Sans chiffre' }]}
        />,
      );
      const items = screen.getAllByRole('listitem');
      expect(items.map((item) => item.textContent)).toEqual(['Trop court', 'Sans chiffre']);
    });

    it('ignore les erreurs undefined ou sans message dans la liste', () => {
      render(<FieldError errors={[undefined, { message: 'Trop court' }, {}, { message: '' }, { message: 'Sans chiffre' }]} />);
      const items = screen.getAllByRole('listitem');
      expect(items.map((item) => item.textContent)).toEqual(['Trop court', 'Sans chiffre']);
    });

    it('garde une liste d’un seul élément si une seule erreur est exploitable parmi plusieurs distinctes', () => {
      render(<FieldError errors={[undefined, { message: 'Trop court' }]} />);
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Trop court']);
    });
  });

  describe('rendu', () => {
    it('pose le rôle alert et le data-slot', () => {
      render(<FieldError>Erreur</FieldError>);
      expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'field-error');
    });

    it('fusionne className avec les classes de base', () => {
      render(<FieldError className="mt-2">Erreur</FieldError>);
      const alerte = screen.getByRole('alert');
      expect(alerte).toHaveClass('mt-2', 'text-sm', 'text-destructive');
    });

    it('transmet les autres props au conteneur', () => {
      render(
        <FieldError id="nom-erreur" data-testid="erreur-nom">
          Erreur
        </FieldError>,
      );
      expect(screen.getByTestId('erreur-nom')).toHaveAttribute('id', 'nom-erreur');
    });

    it('recalcule le contenu quand errors change', () => {
      const { rerender } = render(<FieldError errors={[{ message: 'Premier' }]} />);
      expect(screen.getByRole('alert')).toHaveTextContent('Premier');

      rerender(<FieldError errors={[{ message: 'Premier' }, { message: 'Second' }]} />);
      expect(screen.getAllByRole('listitem')).toHaveLength(2);

      rerender(<FieldError errors={[]} />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
