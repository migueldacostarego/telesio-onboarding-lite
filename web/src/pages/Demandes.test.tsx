import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import type { Demande } from '@/lib/suivi';
import { Demandes } from '@/pages/Demandes';
import { lecturesSuivi, mockApi, reply, stubBureau } from '@/test/helpers';

/** « À venir » dépend du jour : on fige la date (28 octobre 2026) pour que l'ordre ne change pas avec le calendrier. */
const AUJOURDHUI = new Date(2026, 9, 28, 12, 0, 0);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: AUJOURDHUI });
});
afterEach(() => {
  vi.useRealTimers();
});

const demande = (o: Partial<Demande> & Pick<Demande, 'nom'>): Demande => ({
  id: o.nom,
  poste: 'Comptable',
  service: 'Finance',
  dateArrivee: '2026-11-03',
  statut: 'EnAttente',
  etape: 1,
  actions: [],
  ...o,
});

const EXEMPLES: Demande[] = [
  demande({ nom: 'Éloïse Dupont', dateArrivee: '2026-11-03', statut: 'EnAttente', etape: 1, actions: ['approuver', 'refuser'] }),
  demande({ nom: 'Anna Martin', poste: 'Développeuse', service: 'Technique', dateArrivee: '2026-10-20', statut: 'Actif', etape: 3 }),
  demande({ nom: 'Luc Bernard', poste: 'Chargé de paie', service: 'RH', dateArrivee: '2026-10-29', statut: 'Validé', etape: 2, actions: ['activer'] }),
  demande({ nom: 'Sarah Petit', poste: null, service: null, dateArrivee: null, statut: 'Terminé', etape: 4 }),
];
const avec = (demandes: Demande[], tronque = false) => ({ demandes, tronque });

function rendre() {
  const client = createQueryClient();
  const vue = render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Demandes />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return { client, ...vue };
}
const lignes = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const noms = () => lignes().map((l) => within(l).getAllByRole('cell')[0]?.textContent);

describe('chargement', () => {
  it('squelette (en-têtes réels, lignes factices) puis les données, jamais d’écran vide', async () => {
    let finir!: (r: Response) => void;
    mockApi({ suivi: () => new Promise<Response>((resolve) => (finir = resolve)) });
    rendre();

    expect(screen.getByRole('heading', { name: 'Demandes' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Chargement des demandes…');
    expect(screen.getByRole('columnheader', { name: 'Statut' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Rechercher par nom' })).toBeDisabled();
    expect(screen.queryByText('Aucune demande en cours')).not.toBeInTheDocument();

    await act(async () => finir(reply(200, avec(EXEMPLES))));
    expect(await screen.findByText('Anna Martin')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Rechercher par nom' })).toBeEnabled();
  });
});

describe('tableau (bureau)', () => {
  beforeEach(() => mockApi({ suivi: avec(EXEMPLES) }));

  it('colonnes, date en français, badge de statut et progression « n sur 4 »', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Nom', 'Poste', 'Service', 'Arrivée', 'Statut', 'Progression']);
    const eloise = within(screen.getByRole('row', { name: /Éloïse Dupont/ }));
    expect(eloise.getAllByRole('cell').map((c) => c.textContent)).toEqual(['Éloïse Dupont', 'Comptable', 'Finance', '3 nov. 2026', 'En attente', 'Étape 1 sur 4']);
  });

  it('les quatre statuts : libellés et progression', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    const parNom = Object.fromEntries(lignes().map((l) => [within(l).getAllByRole('cell')[0]!.textContent, within(l).getAllByRole('cell').map((c) => c.textContent)]));
    expect(parNom['Éloïse Dupont']).toContain('En attente');
    expect(parNom['Luc Bernard']).toContain('Validée');
    expect(parNom['Anna Martin']).toContain('Activée');
    expect(parNom['Sarah Petit']).toContain('Terminée');
    expect(parNom['Éloïse Dupont']).toContain('Étape 1 sur 4');
    expect(parNom['Luc Bernard']).toContain('Étape 2 sur 4');
    expect(parNom['Anna Martin']).toContain('Étape 3 sur 4');
    expect(parNom['Sarah Petit']).toContain('Étape 4 sur 4');
  });

  it('champs absents : « Non renseigné », « Non renseignée »', async () => {
    rendre();
    const sarah = within(await screen.findByRole('row', { name: /Sarah Petit/ }));
    expect(sarah.getAllByText('Non renseigné')).toHaveLength(2);
    expect(sarah.getByText('Non renseignée')).toBeInTheDocument();
  });

  it('lecture seule : aucun bouton d’action, aucun formulaire, aucun lien de détail', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    // Les actions calculées par le serveur ne sont pas encore proposées.
    expect(screen.queryByRole('button', { name: /valider|refuser|approuver|activer(?!e)|détail/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
  });
});

describe('tri', () => {
  beforeEach(() => mockApi({ suivi: avec(EXEMPLES) }));
  const tri = () => screen.getByRole('columnheader', { name: 'Arrivée' }).getAttribute('aria-sort');

  it('par défaut : arrivées à venir de la plus proche à la plus lointaine, puis les passées, sans date en dernier', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    // Aujourd'hui : 28 oct. Luc 29 oct. et Éloïse 3 nov. à venir ; Anna 20 oct. passée ; Sarah sans date.
    expect(noms()).toEqual(['Luc Bernard', 'Éloïse Dupont', 'Anna Martin', 'Sarah Petit']);
    expect(screen.getByRole('button', { name: /Arrivée : à venir d’abord/ })).toBeInTheDocument();
    expect(tri()).toBe('other');
  });

  it('le bouton fait tourner les trois ordres, les sans date restant toujours en dernier', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');

    await user.click(screen.getByRole('button', { name: /Arrivée : à venir d’abord/ }));
    expect(noms()).toEqual(['Éloïse Dupont', 'Luc Bernard', 'Anna Martin', 'Sarah Petit']);
    expect(tri()).toBe('descending');

    await user.click(screen.getByRole('button', { name: /Arrivée : plus récentes d’abord/ }));
    expect(noms()).toEqual(['Anna Martin', 'Luc Bernard', 'Éloïse Dupont', 'Sarah Petit']);
    expect(tri()).toBe('ascending');
    expect(screen.getByRole('button', { name: /Arrivée : plus anciennes d’abord/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Arrivée : plus anciennes d’abord/ }));
    expect(noms()).toEqual(['Luc Bernard', 'Éloïse Dupont', 'Anna Martin', 'Sarah Petit']);
    expect(tri()).toBe('other');
  });

  it('le passage à un nouveau jour re-trie : l’arrivée de demain devient passée', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: AUJOURDHUI });
    rendre();
    await screen.findByText('Anna Martin');
    expect(noms()).toEqual(['Luc Bernard', 'Éloïse Dupont', 'Anna Martin', 'Sarah Petit']);
    // Le 30 octobre : Luc (29) est passée, Éloïse (3 nov.) reste à venir.
    await act(async () => {
      vi.setSystemTime(new Date(2026, 9, 30, 9, 0, 0));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(noms()).toEqual(['Éloïse Dupont', 'Luc Bernard', 'Anna Martin', 'Sarah Petit']);
  });
});

describe('recherche par nom', () => {
  beforeEach(() => mockApi({ suivi: avec(EXEMPLES) }));

  it('sans tenir compte de la casse ni des accents ; compte « n sur total »', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    expect(screen.getByText('4 demandes')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'ELOISE');
    expect(noms()).toEqual(['Éloïse Dupont']);
    expect(screen.getByText('1 demande sur 4')).toBeInTheDocument();
  });

  it('le terme ne va jamais dans l’URL ni dans le stockage du navigateur', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const avant = window.location.href;
    const historique = window.history.length;
    rendre();
    await screen.findByText('Anna Martin');

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'Dupont');
    await user.click(screen.getByRole('button', { name: 'Activée' }));
    expect(window.location.href).toBe(avant);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(window.history.length).toBe(historique);
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });

  it('aucun résultat : message et bouton pour effacer la recherche et le filtre', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'zzz');
    await user.click(screen.getByRole('button', { name: 'Terminée' }));

    expect(screen.getByText('Aucune demande ne correspond')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune demande en cours')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Effacer la recherche et le filtre' }));
    expect(screen.getByRole('searchbox', { name: 'Rechercher par nom' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Toutes' })).toHaveAttribute('aria-pressed', 'true');
    expect(noms()).toHaveLength(4);
  });
});

describe('filtre par statut', () => {
  beforeEach(() => mockApi({ suivi: avec(EXEMPLES) }));

  it('un statut à la fois, « Toutes » les rétablit, état annoncé par aria-pressed', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    const groupe = within(screen.getByRole('group', { name: 'Filtrer par statut' }));
    expect(groupe.getAllByRole('button').map((b) => b.textContent)).toEqual(['Toutes', 'En attente', 'Validée', 'Activée', 'Terminée']);
    expect(groupe.getByRole('button', { name: 'Toutes' })).toHaveAttribute('aria-pressed', 'true');

    for (const [libelle, attendu] of [['En attente', ['Éloïse Dupont']], ['Validée', ['Luc Bernard']], ['Activée', ['Anna Martin']], ['Terminée', ['Sarah Petit']]] as const) {
      await user.click(groupe.getByRole('button', { name: libelle }));
      expect(noms()).toEqual(attendu);
      expect(groupe.getByRole('button', { name: libelle })).toHaveAttribute('aria-pressed', 'true');
      expect(groupe.getByRole('button', { name: 'Toutes' })).toHaveAttribute('aria-pressed', 'false');
    }
    await user.click(groupe.getByRole('button', { name: 'Toutes' }));
    expect(noms()).toHaveLength(4);
  });

  it('se combine avec la recherche', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    await user.click(screen.getByRole('button', { name: 'Activée' }));
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'martin');
    expect(noms()).toEqual(['Anna Martin']);
    await user.clear(screen.getByRole('searchbox', { name: 'Rechercher par nom' }));
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'dupont');
    expect(screen.getByText('Aucune demande ne correspond')).toBeInTheDocument();
  });
});

describe('états', () => {
  it('vide : « Aucune demande en cours », sans tableau ni compteur', async () => {
    mockApi({ suivi: avec([]) });
    rendre();
    expect(await screen.findByText('Aucune demande en cours')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ demandes?/)).not.toBeInTheDocument();
  });

  it('erreur au premier chargement : ApiErrorAlert et Réessayer, qui relit puis affiche les données', async () => {
    let appels = 0;
    const fetchMock = mockApi({ suivi: () => (++appels === 1 ? reply(500, { error: 'Erreur interne' }) : reply(200, avec(EXEMPLES))) });
    const user = userEvent.setup();
    rendre();
    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur interne');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Anna Martin')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(lecturesSuivi(fetchMock)).toBe(2);
  });

  it('échec d’une actualisation : les dernières données restent affichées, avec l’erreur et Réessayer', async () => {
    let echec = false;
    mockApi({ suivi: () => (echec ? reply(500, { error: 'Erreur interne' }) : reply(200, avec(EXEMPLES))) });
    const user = userEvent.setup();
    const { client } = rendre();
    await screen.findByText('Anna Martin');

    echec = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['suivi'] }).catch(() => undefined);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur interne');
    expect(screen.getByText('Anna Martin')).toBeInTheDocument();

    echec = false;
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText('Anna Martin')).toBeInTheDocument();
  });

  it('tronque : message de liste incomplète, données affichées', async () => {
    mockApi({ suivi: avec(EXEMPLES, true) });
    rendre();
    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Liste incomplète');
    expect(alerte).toHaveTextContent('100 au plus par statut');
    expect(screen.getByText('Anna Martin')).toBeInTheDocument();
  });

  it('pas de message de liste incomplète quand tronque est faux', async () => {
    mockApi({ suivi: avec(EXEMPLES) });
    rendre();
    await screen.findByText('Anna Martin');
    expect(screen.queryByText('Liste incomplète')).not.toBeInTheDocument();
  });
});

describe('actualisation automatique', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true, now: AUJOURDHUI }));
  afterEach(() => vi.useRealTimers());

  it('toutes les 30 s, sans squelette ni clignotement : les lignes restent, les nouvelles apparaissent', async () => {
    let donnees = EXEMPLES;
    let finir: ((r: Response) => void) | undefined;
    let lent = false;
    const fetchMock = mockApi({ suivi: () => (lent ? new Promise<Response>((r) => (finir = r)) : reply(200, avec(donnees))) });
    rendre();
    await screen.findByText('Anna Martin');
    expect(lecturesSuivi(fetchMock)).toBe(1);

    lent = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(lecturesSuivi(fetchMock)).toBe(2);
    // Lecture en cours : le tableau reste, aucun squelette, aucun état de chargement.
    expect(screen.getByText('Anna Martin')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    donnees = [...EXEMPLES, demande({ nom: 'Nina Nouvelle' })];
    await act(async () => finir?.(reply(200, avec(donnees))));
    expect(await screen.findByText('Nina Nouvelle')).toBeInTheDocument();
    expect(screen.getByText('Anna Martin')).toBeInTheDocument();
  });

  it('au retour sur l’onglet : relit si les données ont plus de 5 s, pas avant', async () => {
    const fetchMock = mockApi({ suivi: avec(EXEMPLES) });
    rendre();
    await screen.findByText('Anna Martin');

    // Retour immédiat : données fraîches, aucune lecture.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(lecturesSuivi(fetchMock)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(lecturesSuivi(fetchMock)).toBe(2));
  });

  it('indicateur « Mis à jour … » : à l’instant, vieillit tout seul, repart à zéro après l’actualisation', async () => {
    mockApi({ suivi: avec(EXEMPLES) });
    rendre();
    expect(await screen.findByText('Mis à jour à l’instant')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByText('Mis à jour il y a 20 s')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000); // 30 s : actualisation automatique
    });
    await waitFor(() => expect(screen.getByText('Mis à jour à l’instant')).toBeInTheDocument());
  });
});

describe('mobile', () => {
  beforeEach(() => {
    stubBureau(false);
    mockApi({ suivi: avec(EXEMPLES) });
  });

  it('chaque ligne devient une carte compacte (nom, statut, poste et service, arrivée, progression), sans tableau', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cartes = screen.getAllByRole('listitem');
    expect(cartes).toHaveLength(4);

    // Ordre par défaut : à venir d'abord (Luc 29 oct., Éloïse 3 nov.), puis Anna (passée), puis Sarah (sans date).
    expect(cartes.map((c) => c.textContent?.slice(0, 11))).toEqual(['Luc Bernard', 'Éloïse Dupo', 'Anna Martin', 'Sarah Petit']);
    const eloise = within(cartes[1]!);
    expect(eloise.getByText('Éloïse Dupont')).toBeInTheDocument();
    expect(eloise.getByText('En attente')).toBeInTheDocument();
    expect(eloise.getByText('Comptable · Finance')).toBeInTheDocument();
    expect(eloise.getByText('Arrivée : 3 nov. 2026')).toBeInTheDocument();
    expect(cartes[1]).toHaveTextContent('Étape 1 sur 4');

    const sarah = within(cartes[3]!);
    expect(sarah.getByText('Poste non renseigné')).toBeInTheDocument();
    expect(sarah.getByText('Arrivée : Non renseignée')).toBeInTheDocument();
    expect(sarah.getByText('Terminée')).toBeInTheDocument();
  });

  it('recherche, filtre et tri fonctionnent aussi sur les cartes', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    await user.click(screen.getByRole('button', { name: 'Validée' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Luc Bernard')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Toutes' }));
    await user.click(screen.getByRole('button', { name: /Arrivée : à venir d’abord/ }));
    await user.click(screen.getByRole('button', { name: /Arrivée : plus récentes d’abord/ }));
    expect(screen.getAllByRole('listitem').map((c) => c.textContent?.slice(0, 11))).toEqual(['Anna Martin', 'Luc Bernard', 'Éloïse Dupo', 'Sarah Petit']);
  });

  it('squelette en cartes au chargement', async () => {
    let finir!: (r: Response) => void;
    mockApi({ suivi: () => new Promise<Response>((resolve) => (finir = resolve)) });
    rendre();
    expect(screen.getByRole('status')).toHaveTextContent('Chargement des demandes…');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await act(async () => finir(reply(200, avec(EXEMPLES))));
    expect(await screen.findByText('Anna Martin')).toBeInTheDocument();
  });
});
