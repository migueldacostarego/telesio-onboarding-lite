import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemandesTableSquelette } from '@/components/demandes/DemandesTable';
import { reply, stubBureau } from '@/test/helpers';
import { ELOISE, HUGO, actif, avancer, enAttente, monter, tempsSimule, valide } from '@/test/demandes';

tempsSimule();

// jsdom ne fait pas de mise en page : on vérifie ce qui la fixe (table-layout fixed, largeurs sur l'en-tête, hauteur de ligne,
// troncature) ; les largeurs mesurées dans Chrome sont dans DECISIONS-FRONT.md (Mise en page du tableau).
const rien = () => reply(200, {});
const ANNA = { id: 'id-anna', nom: 'Anna Martin' };
const LONG = 'Directeur adjoint des opérations et de la transformation numérique';
const entetes = () => within(screen.getByRole('table')).getAllByRole('columnheader').map((th) => th.className);
const lignes = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('mise en page du tableau', () => {
  it('largeurs de colonnes fixes : table-layout fixed, une largeur par colonne sauf Nom (qui prend le reste)', async () => {
    stubBureau(true);
    monter({ demandes: [enAttente(ELOISE), valide(HUGO, { actions: ['activer'] })], ecrire: rien });
    await screen.findByText('Hugo Lambert');
    expect(screen.getByRole('table')).toHaveClass('table-fixed');
    const [nom, ...autres] = entetes();
    expect(nom).not.toMatch(/(^|\s)w-/);
    for (const classes of autres) expect(classes).toMatch(/(^|\s)w-\d+(\s|$)/);
  });

  it('les largeurs ne dépendent pas du contenu : mêmes classes avant et après un filtre, une validation, une synchronisation', async () => {
    stubBureau(true);
    const { user } = monter({ demandes: [enAttente(ELOISE), actif(HUGO), enAttente(ANNA, { poste: LONG, service: LONG })], ecrire: () => reply(200, { id: ELOISE.id, statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    const avant = entetes();

    await user.type(screen.getByRole('searchbox'), 'hugo');
    await avancer(400);
    expect(lignes()).toHaveLength(1);
    expect(entetes()).toEqual(avant);

    await user.clear(screen.getByRole('searchbox'));
    await avancer(400);
    await user.click(screen.getByRole('button', { name: `Valider la demande de ${ELOISE.nom}` }));
    await avancer(100);
    expect(entetes()).toEqual(avant);
  });

  it('une hauteur de ligne unique, que la ligne soit en synchronisation, occupée ou sans bouton', async () => {
    stubBureau(true);
    const { user } = monter({ demandes: [enAttente(ELOISE), valide(HUGO, { actions: ['activer', 'reprendre'] }), actif(ANNA)], ecrire: () => reply(200, { id: ELOISE.id, statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    const hauteurs = () => lignes().map((l) => l.className.match(/h-\[[^\]]+\]/)?.[0]);
    const avant = hauteurs();
    expect(new Set(avant).size).toBe(1);
    expect(avant[0]).toBeDefined();

    await user.click(screen.getByRole('button', { name: `Valider la demande de ${ELOISE.nom}` }));
    await avancer(100);
    expect(screen.getByText('synchronisation…')).toBeInTheDocument(); // l'API la rend encore en attente
    expect(hauteurs()).toEqual(avant);
  });

  it('textes longs : une ligne tronquée, la valeur entière en infobulle (nom, poste, service, adresse)', async () => {
    stubBureau(true);
    monter({ demandes: [enAttente(ANNA, { poste: LONG, service: 'Service des relations institutionnelles et partenariats internationaux' })], ecrire: rien });
    const ligne = await screen.findByRole('row', { name: /Anna Martin/ });
    for (const texte of [LONG, 'Service des relations institutionnelles et partenariats internationaux', 'compte.anna@exemple.test']) {
      const e = within(ligne).getByText(texte);
      expect(e).toHaveAttribute('title', texte);
      expect(e.closest('td, span')).not.toBeNull();
    }
    expect(within(ligne).getByText(LONG).closest('td')).toHaveClass('truncate');
    expect(within(ligne).getByText('compte.anna@exemple.test')).toHaveClass('truncate');
    const bouton = within(ligne).getByRole('link', { name: 'Voir le détail de la demande de Anna Martin' });
    expect(bouton).toHaveClass('truncate');
    expect(bouton).toHaveAttribute('title', 'Anna Martin');
  });

  it('colonne Actions : les boutons restent sur une ligne dans le tableau, passent à la ligne sur la page de détail', async () => {
    stubBureau(true);
    const { user } = monter({ demandes: [valide(HUGO, { actions: ['activer', 'reprendre'] })], ecrire: rien });
    const ligne = await screen.findByRole('row', { name: /Hugo Lambert/ });
    const groupe = within(ligne).getByRole('button', { name: /Activer le compte/ }).parentElement as HTMLElement;
    expect(groupe).toHaveClass('flex-nowrap');
    await user.click(within(ligne).getByRole('link', { name: 'Voir le détail de la demande de Hugo Lambert' }));
    await screen.findByText('Historique');
    expect(screen.getByRole('button', { name: /Activer le compte/ }).parentElement).toHaveClass('flex-wrap');
  });

  it('le squelette a les mêmes colonnes et la même hauteur de ligne que les données', async () => {
    stubBureau(true);
    monter({ demandes: [enAttente(ELOISE)], ecrire: rien });
    await screen.findByText('Éloïse Dupont');
    const donnees = { table: screen.getByRole('table').className, entetes: entetes(), ligne: lignes()[0]!.className.match(/h-\[[^\]]+\]/)?.[0] };
    const { container } = render(<DemandesTableSquelette tri="recentes" />);
    const t = container.querySelector('table')!;
    expect(t.className).toBe(donnees.table);
    expect([...t.querySelectorAll('th')].map((th) => th.className)).toEqual(donnees.entetes);
    expect([...t.querySelectorAll('tbody tr')].every((tr) => tr.className.includes(donnees.ligne!))).toBe(true);
  });
});
