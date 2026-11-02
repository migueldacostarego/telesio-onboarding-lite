import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompteEtAcces, Identite } from '@/components/demandes/FicheDetail';
import type { DemandeDetail } from '@/lib/detail';
import { ELOISE, detailDe, enAttente, valide } from '@/test/demandes';

const valeur = (zone: HTMLElement, libelle: string) => within(zone).getByText(libelle).nextElementSibling as HTMLElement;
const detail = (surcharge: Partial<DemandeDetail> = {}) => detailDe(valide(ELOISE), surcharge);

describe('Identite', () => {
  it('toutes les valeurs, et le bouton qui copie l’adresse', () => {
    render(<Identite d={detail({ typeContrat: 'Contractor' })} />);
    const zone = screen.getByRole('region', { name: 'Identité' });
    expect(valeur(zone, 'E-mail')).toHaveTextContent('compte.eloise@exemple.test');
    expect(within(zone).getByRole('button', { name: 'Copier l’adresse e-mail de Éloïse Dupont' })).toBeInTheDocument();
    expect(valeur(zone, 'Type de contrat')).toHaveTextContent('Contractor');
    expect(valeur(zone, 'Poste')).toHaveTextContent('Comptable');
    expect(valeur(zone, 'Service')).toHaveTextContent('Finance');
    expect(valeur(zone, 'Responsable')).toHaveTextContent('Chef Exemple');
    expect(valeur(zone, 'Arrivée')).toHaveTextContent('3 nov. 2026');
  });

  it('valeurs absentes : « Non renseigné » partout, sans bouton de copie', () => {
    render(<Identite d={detail({ upn: null, typeContrat: null, poste: null, service: null, manager: null, dateArrivee: null })} />);
    const zone = screen.getByRole('region', { name: 'Identité' });
    for (const libelle of ['E-mail', 'Type de contrat', 'Poste', 'Service', 'Responsable', 'Arrivée']) {
      expect(valeur(zone, libelle)).toHaveTextContent('Non renseigné');
    }
    expect(within(zone).queryByRole('button')).not.toBeInTheDocument();
  });

  it('type de contrat non fourni (compte antérieur au formulaire) : « Non renseigné »', () => {
    render(<Identite d={detail()} />);
    expect(valeur(screen.getByRole('region', { name: 'Identité' }), 'Type de contrat')).toHaveTextContent('Non renseigné');
  });
});

describe('CompteEtAcces', () => {
  const zone = () => screen.getByRole('region', { name: 'Compte et accès' });

  describe('licence', () => {
    it('aucune : « Non renseigné »', () => {
      render(<CompteEtAcces d={detail({ licence: null })} />);
      expect(valeur(zone(), 'Licence')).toHaveTextContent('Non renseigné');
    });

    it.each([
      ['choisie', 'prévue, attribuée à la validation'],
      ['attribuee', 'attribuée'],
      ['en_cours', 'attribution en cours'],
      ['erreur', 'attribution en erreur'],
      ['inconnu', 'état illisible'],
    ] as const)('état %s : « %s »', (etat, libelle) => {
      render(<CompteEtAcces d={detail({ licence: { libelle: 'Business Premium', etat } })} />);
      expect(valeur(zone(), 'Licence')).toHaveTextContent(`Business Premium : ${libelle}`);
    });

    it('licence qui n’est plus dans la liste (libellé inconnu)', () => {
      render(<CompteEtAcces d={detail({ licence: { libelle: null, etat: 'attribuee' } })} />);
      expect(valeur(zone(), 'Licence')).toHaveTextContent('Licence retirée de la liste : attribuée');
    });
  });

  describe('groupe des arrivants', () => {
    it('demande en attente : ajouté à la validation', () => {
      render(<CompteEtAcces d={detailDe(enAttente(ELOISE))} />);
      expect(valeur(zone(), 'Arrivants')).toHaveTextContent('Ajouté à la validation');
    });

    it('membre, non membre, illisible', () => {
      const { rerender } = render(<CompteEtAcces d={detail({ groupeArrivants: { membre: true } })} />);
      expect(valeur(zone(), 'Arrivants')).toHaveTextContent(/^Membre$/);
      rerender(<CompteEtAcces d={detail({ groupeArrivants: { membre: false } })} />);
      expect(valeur(zone(), 'Arrivants')).toHaveTextContent('Non membre');
      rerender(<CompteEtAcces d={detail({ groupeArrivants: null })} />);
      expect(valeur(zone(), 'Arrivants')).toHaveTextContent('Indisponible');
    });
  });

  describe('dossier SharePoint', () => {
    it('demande en attente : créé à la validation, sans lien', () => {
      render(<CompteEtAcces d={detailDe(enAttente(ELOISE))} />);
      expect(valeur(zone(), 'Dossier')).toHaveTextContent('Créé à la validation');
      expect(within(zone()).queryByRole('link')).not.toBeInTheDocument();
    });

    it('illisible (null) : « Indisponible »', () => {
      render(<CompteEtAcces d={detail({ dossier: null })} />);
      expect(valeur(zone(), 'Dossier')).toHaveTextContent('Indisponible');
    });

    it('absent : « Non créé »', () => {
      render(<CompteEtAcces d={detail({ dossier: { etat: 'absent' } })} />);
      expect(valeur(zone(), 'Dossier')).toHaveTextContent('Non créé');
    });

    it('adresse https : lien vers SharePoint dans un nouvel onglet', () => {
      render(<CompteEtAcces d={detail({ dossier: { etat: 'present', url: 'https://sp.exemple.test/dossier' } })} />);
      const lien = within(zone()).getByRole('link', { name: /Ouvrir dans SharePoint/ });
      expect(lien).toHaveAttribute('href', 'https://sp.exemple.test/dossier');
      expect(lien).toHaveAttribute('target', '_blank');
      expect(lien).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it.each([['sans adresse', null], ['http', 'http://sp.exemple.test/dossier'], ['javascript:', 'javascript:alert(1)'], ['mal formée', 'pas une adresse']])('présent, adresse %s : « Créé », jamais un lien', (_cas, url) => {
      render(<CompteEtAcces d={detail({ dossier: { etat: 'present', url } })} />);
      expect(valeur(zone(), 'Dossier')).toHaveTextContent(/^Créé$/);
      expect(within(zone()).queryByRole('link')).not.toBeInTheDocument();
    });
  });
});
