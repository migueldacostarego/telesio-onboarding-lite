import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import type { Demande } from '@/lib/suivi';
import { Demandes } from '@/pages/Demandes';
import { FournisseurDemandes } from '@/pages/FournisseurDemandes';
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
  upn: null,
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
  demande({ nom: 'Sarah Petit', poste: null, service: null, dateArrivee: null, statut: 'Terminé', etape: 4, termineCeMois: true }),
];
const avec = (demandes: Demande[], tronque = false) => ({ demandes, tronque });

function rendre() {
  const client = createQueryClient();
  const vue = render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <FournisseurDemandes>
          <Demandes />
        </FournisseurDemandes>
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return { client, ...vue };
}
const lignes = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const noms = () => lignes().map((l) => within(l).getAllByRole('link')[0]?.textContent);
/** Compteur-filtre : « En attente », « À activer », « En cours » ou « Terminées ». */
const compteur = (nom: string) => within(screen.getByRole('group', { name: 'Filtrer par groupe de demandes' })).getByRole('button', { name: new RegExp(`^${nom}`) });

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

  it('colonnes : personne (initiales, nom, adresse), poste et service, arrivée relative, statut avec étape et phrase d’état, actions', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Personne', 'Poste', 'Arrivée', 'Statut', 'Actions']);
    const cells = within(screen.getByRole('row', { name: /Éloïse Dupont/ })).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[0]).toContain('Éloïse Dupont');
    expect(cells[0]).toContain('ÉD'); // initiales
    expect(cells[1]).toBe('ComptableFinance');
    expect(cells[2]).toBe('3 nov. 2026Dans 6 j'); // aujourd'hui : 28 oct. 2026 (Paris)
    expect(cells[3]).toBe('En attenteÉtape 1 sur 4En attente de la direction');
    expect(cells[4]).toBe('Valider');
  });

  it('les quatre statuts : libellé, étape et phrase d’état', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    const statut = (nom: string) => within(screen.getByRole('row', { name: new RegExp(nom) })).getAllByRole('cell')[3]!.textContent;
    expect(statut('Éloïse Dupont')).toBe('En attenteÉtape 1 sur 4En attente de la direction');
    expect(statut('Luc Bernard')).toBe('ValidéeÉtape 2 sur 4À activer maintenant');
    expect(statut('Anna Martin')).toBe('ActivéeÉtape 3 sur 4En attente de la 1re connexion');
    expect(statut('Sarah Petit')).toBe('TerminéeÉtape 4 sur 4Onboarding terminé');
    for (const [nom, attendu] of [['Éloïse Dupont', 'EnAttente'], ['Luc Bernard', 'Validé'], ['Anna Martin', 'Actif'], ['Sarah Petit', 'Terminé']] as const) {
      expect(screen.getByRole('row', { name: new RegExp(nom) }).querySelector('[data-slot="statut"]')).toHaveAttribute('data-statut', attendu);
    }
  });

  it('champs absents : « Non renseigné », « Non renseignée »', async () => {
    rendre();
    const sarah = within(await screen.findByRole('row', { name: /Sarah Petit/ }));
    expect(sarah.getAllByText('Non renseigné')).toHaveLength(1);
    expect(sarah.getByText('Non renseignée')).toBeInTheDocument();
  });

  it('une action principale par ligne et un menu « … », seulement selon `actions` de l’API ; rien pour le reste', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    expect(screen.getAllByRole('button', { name: /^(Valider|Refuser|Activer|Régénérer|Réessayer)/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Activer le compte de Luc Bernard',
      'Valider la demande de Éloïse Dupont',
    ]);
    // Un menu par ligne, nommé d'après la personne.
    expect(screen.getAllByRole('button', { name: /^Autres actions pour/ })).toHaveLength(4);

    await user.click(screen.getByRole('button', { name: 'Autres actions pour Éloïse Dupont' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.getAttribute('aria-label') ?? m.textContent)).toEqual(['Voir le détail', 'Refuser la demande de Éloïse Dupont']);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Autres actions pour Sarah Petit' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Voir le détail']); // Terminée : rien d'autre
    expect(document.querySelector('form')).toBeNull();
  });

  it('une entrée du menu « … » n’ouvre pas la page de la demande (le clic ne remonte pas à la ligne)', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    await user.click(screen.getByRole('button', { name: 'Autres actions pour Éloïse Dupont' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refuser la demande de Éloïse Dupont' }));
    expect(await screen.findByRole('dialog', { name: 'Refuser la demande de Éloïse Dupont ?' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // « Voir le détail » du menu, lui, ouvre la page.
    await user.click(screen.getByRole('button', { name: 'Autres actions pour Anna Martin' }));
    await user.click(screen.getByRole('menuitem', { name: 'Voir le détail' }));
    expect(decodeURIComponent(window.location.pathname)).toBe(`/demandes/${EXEMPLES[1]!.id}`);
  });

  it('liens : le nom de chaque demande vers sa page (l’objectId, rien d’autre, dans l’adresse)', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    const attendu = ['Luc Bernard', 'Éloïse Dupont', 'Anna Martin', 'Sarah Petit'].map((nom) => `/demandes/${EXEMPLES.find((d) => d.nom === nom)!.id}`);
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(attendu);
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
    await user.click(compteur('En cours'));
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
    await user.click(compteur('Terminées'));

    expect(screen.getByText('Aucune demande ne correspond')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune demande en cours')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Effacer la recherche et le filtre' }));
    expect(screen.getByRole('searchbox', { name: 'Rechercher par nom' })).toHaveValue('');
    expect(compteur('Terminées')).toHaveAttribute('aria-pressed', 'false');
    expect(noms()).toHaveLength(4);
  });
});

describe('compteurs et filtre', () => {
  beforeEach(() => mockApi({ suivi: avec(EXEMPLES) }));

  it('quatre compteurs qui partagent les demandes (leur somme est le total) et filtrent, un second clic retire le filtre', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    const groupe = within(screen.getByRole('group', { name: 'Filtrer par groupe de demandes' }));
    expect(groupe.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'En attente1À valider par la direction',
      'À activer1Jour d’arrivée atteint',
      'En cours1Validées et en onboarding',
      'Terminées1Ce mois-ci, heure de Paris',
    ]);
    expect(groupe.getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);

    for (const [nom, attendu] of [['En attente', ['Éloïse Dupont']], ['À activer', ['Luc Bernard']], ['En cours', ['Anna Martin']], ['Terminées', ['Sarah Petit']]] as const) {
      await user.click(compteur(nom));
      expect(noms()).toEqual(attendu);
      expect(compteur(nom)).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText(`1 demande sur 4`)).toBeInTheDocument();
    }
    await user.click(compteur('Terminées')); // second clic : retire le filtre
    expect(compteur('Terminées')).toHaveAttribute('aria-pressed', 'false');
    expect(noms()).toHaveLength(4);
  });

  it('« Tout afficher » retire le filtre ; le filtre se combine avec la recherche', async () => {
    const user = userEvent.setup();
    rendre();
    await screen.findByText('Anna Martin');
    expect(screen.queryByRole('button', { name: 'Tout afficher' })).not.toBeInTheDocument();
    await user.click(compteur('En cours'));
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'martin');
    expect(noms()).toEqual(['Anna Martin']);
    await user.clear(screen.getByRole('searchbox', { name: 'Rechercher par nom' }));
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'dupont');
    expect(screen.getByText('Aucune demande ne correspond')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Rechercher par nom' }));
    await user.click(screen.getByRole('button', { name: 'Tout afficher' }));
    expect(noms()).toHaveLength(4);
  });

  it('liste incomplète : les nombres sont des minimums (« + », dit aux lecteurs d’écran)', async () => {
    mockApi({ suivi: avec(EXEMPLES, true) });
    rendre();
    await screen.findByText('Anna Martin');
    expect(compteur('En attente')).toHaveTextContent('1+');
    expect(compteur('En attente')).toHaveTextContent('au moins');
  });

  it('Terminées : seulement celles de ce mois ; une Terminée du mois dernier reste dans la liste sans compteur ; « + » quand le mois est inconnu', async () => {
    const user = userEvent.setup();
    const terminee = (nom: string, termineCeMois?: boolean | null) => demande({ nom, statut: 'Terminé', etape: 4, termineCeMois });
    mockApi({ suivi: avec([terminee('Ce Mois', true), terminee('Mois Dernier', false), terminee('Inconnu', null), demande({ nom: 'Attente', actions: ['approuver'] })]) });
    rendre();
    await screen.findByText('Ce Mois');
    expect(compteur('Terminées')).toHaveTextContent('1+'); // un compte dont on ne connaît pas le mois : minimum
    expect(compteur('Terminées')).toHaveTextContent('au moins');
    expect(noms()).toHaveLength(4); // « Toutes » : la Terminée du mois dernier y est
    await user.click(compteur('Terminées'));
    expect(noms().sort()).toEqual(['Ce Mois', 'Inconnu']); // le filtre : ce mois-ci et l'incertaine, pas le mois dernier
  });

  it('Terminées : pas de « + » quand toutes les dates sont connues', async () => {
    mockApi({ suivi: avec([demande({ nom: 'Alice Fin', statut: 'Terminé', etape: 4, termineCeMois: true }), demande({ nom: 'Bruno Fin', statut: 'Terminé', etape: 4, termineCeMois: false })]) });
    rendre();
    await screen.findByText('Alice Fin');
    expect(compteur('Terminées')).toHaveTextContent(/^Terminées1Ce mois-ci, heure de Paris$/);
  });

  it('« À activer » est marqué quand il n’est pas vide : le travail du jour', async () => {
    rendre();
    await screen.findByText('Anna Martin');
    expect(compteur('À activer').querySelector('span.bg-primary')).not.toBeNull();
    expect(compteur('En attente').querySelector('span.bg-primary')).toBeNull();
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
    expect(cartes.map((c) => within(c).getAllByRole('link')[0]!.textContent)).toEqual(['Luc Bernard', 'Éloïse Dupont', 'Anna Martin', 'Sarah Petit']);
    const eloise = within(cartes[1]!);
    expect(eloise.getByText('Éloïse Dupont')).toBeInTheDocument();
    expect(eloise.getByText('En attente')).toBeInTheDocument();
    expect(eloise.getByText('Comptable · Finance')).toBeInTheDocument();
    expect(eloise.getByText('Arrivée : 3 nov. 2026')).toBeInTheDocument();
    expect(eloise.getByText('(dans 6 j)')).toBeInTheDocument();
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
    await user.click(compteur('À activer'));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Luc Bernard')).toBeInTheDocument();
    await user.click(compteur('À activer'));
    await user.click(screen.getByRole('button', { name: /Arrivée : à venir d’abord/ }));
    await user.click(screen.getByRole('button', { name: /Arrivée : plus récentes d’abord/ }));
    expect(screen.getAllByRole('listitem').map((c) => within(c).getAllByRole('link')[0]!.textContent)).toEqual(['Anna Martin', 'Luc Bernard', 'Éloïse Dupont', 'Sarah Petit']);
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
