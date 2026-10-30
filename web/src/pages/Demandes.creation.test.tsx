import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ecritures, lecturesSuivi, reply } from '@/test/helpers';
import { CAMILLE, DROITS_DIRECTION } from '@/test/helpers';
import { ELOISE, HUGO, avancer, enAttente, monter, tempsSimule } from '@/test/demandes';

tempsSimule();

const MANAGER = { id: '11111111-2222-4333-8444-555555555555', displayName: 'Marie Responsable', mail: 'marie.responsable@exemple.test' };
const AUTRE = { id: '66666666-7777-4888-9999-000000000000', displayName: 'Marc Responsable', mail: null };
const SKU = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SKU_VIDE = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LICENCES = { licences: [{ skuId: SKU, libelle: 'Business Premium', disponibles: 3 }, { skuId: SKU_VIDE, libelle: 'Basic', disponibles: 0 }] };
const CREEE = { id: 'id-nouveau', userPrincipalName: 'camille.durand@exemple.test', statut: 'EnAttente' };

const lire = (url: string) => (url.startsWith('/api/annuaire?q=') ? reply(200, [MANAGER, AUTRE]) : url === '/api/licences' ? reply(200, LICENCES) : undefined);
const nouvelleLigne = () => enAttente({ id: CREEE.id, nom: 'Camille Durand' }, { poste: 'Analyste', service: 'Finance', dateArrivee: '2026-11-16' });
const base = { demandes: [enAttente(ELOISE), enAttente(HUGO)], lire };
const ouvrir = async (user: UserEvent) => {
  await user.click(screen.getByRole('button', { name: 'Nouvelle demande' }));
  const panneau = await screen.findByRole('dialog', { name: 'Nouvelle demande' });
  await within(panneau).findByLabelText('Prénom'); // le formulaire est chargé à la première ouverture
  return panneau;
};
const champ = (nom: string) => screen.getByLabelText(nom);

/** Remplit tout, responsable compris (recherche, attente de 300 ms, choix dans la liste). */
async function remplir(user: UserEvent, o: { date?: string; sansManager?: boolean } = {}) {
  await user.type(champ('Prénom'), '  Camille ');
  await user.type(champ('Nom'), 'Durand');
  await user.type(champ('Poste'), 'Analyste');
  await user.type(champ('Service'), 'Finance');
  fireEvent.change(champ('Date d’arrivée'), { target: { value: o.date ?? '2026-11-16' } });
  if (!o.sansManager) {
    await user.type(screen.getByRole('combobox', { name: 'Responsable' }), 'marie');
    await avancer(300);
    await user.click(await screen.findByRole('option', { name: /Marie Responsable/ }));
  }
  await screen.findByRole('option', { name: /Business Premium/ });
  await user.selectOptions(champ('Licence'), SKU);
}

describe('bouton « Nouvelle demande »', () => {
  it('seulement avec le droit creer (d’après /api/moi, jamais d’après un rôle)', async () => {
    const sans = monter({ ...base, moi: { ...CAMILLE, droits: { acces: true, creer: false, approuver: true, activer: false } }, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    expect(screen.queryByRole('button', { name: 'Nouvelle demande' })).not.toBeInTheDocument();
    sans.unmount();

    monter({ ...base, moi: { ...CAMILLE, roles: ['Direction'], droits: DROITS_DIRECTION }, ecrire: () => reply(201, CREEE) });
    expect(await screen.findByRole('button', { name: 'Nouvelle demande' })).toBeInTheDocument();
  });
});

describe('validation côté interface (zod)', () => {
  it('envoi à vide : une erreur sous chaque champ, rien n’est envoyé', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));

    for (const [nom, erreur] of [['Prénom', 'Prénom requis'], ['Nom', 'Nom requis'], ['Poste', 'Poste requis'], ['Service', 'Service requis'], ['Date d’arrivée', 'Date d’arrivée requise'], ['Licence', 'Choisissez une licence']] as const) {
      expect(champ(nom)).toHaveAttribute('aria-invalid', 'true');
      expect(champ(nom)).toHaveAccessibleDescription(erreur);
    }
    expect(within(panneau).getByText('Choisissez le responsable dans la liste')).toBeInTheDocument();
    expect(ecritures(fetchMock)).toHaveLength(0);
  });

  it('date dans le passé refusée, champs trop longs refusés', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user, { date: '2026-10-01' });
    fireEvent.change(champ('Poste'), { target: { value: 'x'.repeat(129) } });
    await user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));
    expect(champ('Date d’arrivée')).toHaveAccessibleDescription('La date d’arrivée ne peut pas être dans le passé');
    expect(champ('Poste')).toHaveAccessibleDescription('128 caractères au plus');
    expect(ecritures(fetchMock)).toHaveLength(0);
  });
});

describe('responsable : recherche dans l’annuaire', () => {
  const annuaire = (fetchMock: ReturnType<typeof monter>['fetchMock']) => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/annuaire'));

  it('2 caractères au moins, attente de 300 ms après la dernière frappe, une seule requête pour le dernier terme', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    const recherche = screen.getByRole('combobox', { name: 'Responsable' });

    await user.type(recherche, 'm');
    await avancer(1_000);
    expect(annuaire(fetchMock)).toHaveLength(0);
    expect(screen.getByText('Saisissez 2 caractères au moins.')).toBeInTheDocument();

    await user.type(recherche, 'ar'); // « mar »
    await avancer(150); // bien avant 300 ms, même si le temps réel s'ajoute au temps simulé
    expect(annuaire(fetchMock)).toHaveLength(0);
    await avancer(300);
    await screen.findByRole('option', { name: /Marie Responsable/ });
    expect(annuaire(fetchMock)).toEqual(['/api/annuaire?q=mar']);
  });

  it('le terme n’est ni dans l’adresse de la page ni dans le stockage du navigateur', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const avant = window.location.href;
    await ouvrir(user);
    await user.type(screen.getByRole('combobox', { name: 'Responsable' }), 'secretnom');
    await avancer(400);
    await screen.findByRole('listbox');
    expect(window.location.href).toBe(avant);
    expect(JSON.stringify({ ...localStorage })).not.toContain('secretnom');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secretnom');
  });

  it('choix à la souris puis « Changer » ; au clavier : flèches et Entrée, sans jamais envoyer le formulaire', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    await user.type(screen.getByRole('combobox', { name: 'Responsable' }), 'mar');
    await avancer(300);
    await screen.findByRole('option', { name: /Marc Responsable/ });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByText('Marc Responsable')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Responsable' })).not.toBeInTheDocument();
    expect(ecritures(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Changer de responsable/ }));
    expect(screen.getByRole('combobox', { name: 'Responsable' })).toHaveValue('');
  });

  it('aucun résultat, et erreur de l’annuaire dans le champ', async () => {
    const { user } = monter({ ...base, lire: (u) => (u.startsWith('/api/annuaire') ? reply(200, []) : lire(u)), ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    await user.type(screen.getByRole('combobox', { name: 'Responsable' }), 'zzz');
    await avancer(300);
    expect(await screen.findByText('Aucun résultat.')).toBeInTheDocument();
  });

  it('Échap ferme d’abord la liste des résultats, puis le panneau', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    await user.type(screen.getByRole('combobox', { name: 'Responsable' }), 'mar');
    await avancer(300);
    await screen.findByRole('option', { name: /Marie Responsable/ });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); // masquée
    expect(screen.getByRole('dialog', { name: 'Nouvelle demande' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('licence', () => {
  it('liste déroulante d’après /api/licences : « libellé : N disponibles », grisée à 0', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    const premiere = await screen.findByRole('option', { name: 'Business Premium : 3 disponibles' });
    expect(premiere).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Basic : aucune disponible' })).toBeDisabled();
  });

  it('erreur de lecture : message et Réessayer', async () => {
    let panne = true;
    const { user } = monter({ ...base, lire: (u) => (u === '/api/licences' && panne ? reply(503, { error: 'Licences non configurées (LICENSES)' }) : lire(u)), ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await avancer(4_000); // une lecture est rejouée deux fois sur un 503 (query.ts)
    expect(await within(panneau).findByRole('alert')).toHaveTextContent('Licences non configurées');
    panne = false;
    await user.click(within(panneau).getByRole('button', { name: 'Réessayer' }));
    expect(await within(panneau).findByRole('option', { name: /Business Premium/ })).toBeInTheDocument();
  });
});

describe('envoi', () => {
  it('POST /api/demandes avec les sept champs (nettoyés), le panneau se ferme, la liste est relue et la nouvelle ligne mise en évidence', async () => {
    const { etat, fetchMock, user } = monter({
      ...base,
      ecrire: () => {
        etat.demandes = [...etat.demandes, nouvelleLigne()];
        return reply(201, CREEE);
      },
    });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));

    expect(ecritures(fetchMock)).toEqual([
      { url: '/api/demandes', corps: { prenom: 'Camille', nom: 'Durand', poste: 'Analyste', service: 'Finance', dateArrivee: '2026-11-16', managerId: MANAGER.id, licence: SKU } },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Demande créée pour Camille Durand')).toBeInTheDocument();
    expect(screen.getByText('Elle attend la validation de la direction.')).toBeInTheDocument();

    await waitFor(() => expect(lecturesSuivi(fetchMock)).toBeGreaterThanOrEqual(2));
    const ligne = await screen.findByRole('row', { name: /Camille Durand/ });
    expect(ligne).toHaveAttribute('data-nouvelle', 'true');
    expect(ligne).toHaveTextContent('nouvelle demande');
    expect(screen.getByRole('row', { name: /Hugo Lambert/ })).not.toHaveAttribute('data-nouvelle');
    // Un second clic sur le bouton rouvre un formulaire vide.
    await user.click(screen.getByRole('button', { name: 'Nouvelle demande' }));
    expect(await screen.findByLabelText('Prénom')).toHaveValue('');
  });

  it('la ligne créée n’est pas encore répliquée : elle est affichée tout de suite avec « synchronisation… », la liste est relue toutes les 5 s, l’indicateur part quand l’API la rend', async () => {
    const { etat, fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // L'API ne la renvoie pas encore : la ligne est là quand même, mise en évidence, avec ce que la personne a saisi.
    const ligne = await screen.findByRole('row', { name: /Camille Durand/ });
    expect(ligne).toHaveAttribute('data-nouvelle', 'true');
    expect(within(ligne).getByText('En attente')).toBeInTheDocument();
    expect(within(ligne).getByText('Analyste')).toBeInTheDocument();
    // L'adresse que le serveur vient d'attribuer est là aussi, sans attendre l'API.
    expect(within(ligne).getByText(CREEE.userPrincipalName)).toBeInTheDocument();
    expect(within(ligne).getByText('synchronisation…')).toBeInTheDocument();

    // Relue toutes les 5 s ; toujours là tant que l'API ne la rend pas.
    const avant = lecturesSuivi(fetchMock);
    await avancer(11_000);
    expect(lecturesSuivi(fetchMock)).toBeGreaterThan(avant);
    expect(within(screen.getByRole('row', { name: /Camille Durand/ })).getByText('synchronisation…')).toBeInTheDocument();

    etat.demandes = [...etat.demandes, nouvelleLigne()];
    await avancer(5_100);
    await waitFor(() => expect(within(screen.getByRole('row', { name: /Camille Durand/ })).queryByText('synchronisation…')).not.toBeInTheDocument());
    expect(screen.getByRole('row', { name: /Camille Durand/ })).toHaveAttribute('data-nouvelle', 'true');
  });

  it('la recherche et le filtre ne masquent pas la nouvelle ligne', async () => {
    const { etat, user } = monter({ ...base, ecrire: () => { etat.demandes = [...etat.demandes, nouvelleLigne()]; return reply(201, CREEE); } });
    await screen.findByText('Hugo Lambert');
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'hugo');
    const panneau = await ouvrir(user);
    await remplir(user);
    await user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));
    expect(await screen.findByRole('row', { name: /Camille Durand/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Rechercher par nom' })).toHaveValue('');
  });

  it('avertissement manager_non_affecte : affiché, avec la consigne de ne pas renvoyer la demande', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, { ...CREEE, avertissement: 'manager_non_affecte' }) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));
    expect(await screen.findByText(/responsable n’a pas pu être affecté/)).toBeInTheDocument();
    expect(screen.getByText(/Ne renvoyez pas la demande/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fermer ce message' }));
    expect(screen.queryByText('Demande créée pour Camille Durand')).not.toBeInTheDocument();
  });

  it('pendant l’envoi : bouton occupé, un seul POST, le panneau ne se ferme ni par Échap ni par Annuler', async () => {
    let finir!: (r: Response) => void;
    const { fetchMock, user } = monter({ ...base, ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));

    const occupe = within(panneau).getByRole('button', { name: 'Création…' });
    expect(occupe).toBeDisabled();
    expect(within(panneau).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    await user.keyboard('{Escape}');
    fireEvent.submit(panneau.querySelector('form')!);
    expect(screen.getByRole('dialog', { name: 'Nouvelle demande' })).toBeInTheDocument();
    expect(ecritures(fetchMock)).toHaveLength(1);

    await act(async () => finir(reply(201, CREEE)));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('un clic à côté ne ferme pas le panneau (saisie conservée) ; Annuler le ferme, il repart vide', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await user.type(champ('Prénom'), 'Camille');
    fireEvent.pointerDown(document.querySelector('[data-slot="sheet-overlay"]')!);
    expect(screen.getByRole('dialog', { name: 'Nouvelle demande' })).toBeInTheDocument();
    expect(champ('Prénom')).toHaveValue('Camille');

    await user.click(within(panneau).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await ouvrir(user);
    expect(champ('Prénom')).toHaveValue('');
  });
});

describe('erreurs de l’API', () => {
  const soumettre = async (ecrire: () => Response, o: Parameters<typeof remplir>[1] = {}) => {
    const m = monter({ ...base, ecrire });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(m.user);
    await remplir(m.user, o);
    await m.user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));
    return { ...m, panneau };
  };

  it('400 : le message du serveur sous chaque champ concerné, le panneau reste ouvert avec la saisie', async () => {
    const { panneau, fetchMock } = await soumettre(() => reply(400, { error: 'Entrée invalide', details: { prenom: 'doit contenir au moins une lettre latine ou un chiffre', dateArrivee: 'ne peut pas être dans le passé', managerId: 'objectId Entra (GUID) requis' } }));
    await waitFor(() => expect(champ('Prénom')).toHaveAccessibleDescription('doit contenir au moins une lettre latine ou un chiffre'));
    expect(champ('Date d’arrivée')).toHaveAccessibleDescription('ne peut pas être dans le passé');
    expect(within(panneau).getByText('objectId Entra (GUID) requis')).toBeInTheDocument();
    expect(champ('Nom')).toHaveValue('Durand');
    expect(screen.getByRole('dialog', { name: 'Nouvelle demande' })).toBeInTheDocument();
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('409 licence_indisponible : message sous la licence, licences relues', async () => {
    const { panneau, fetchMock } = await soumettre(() => reply(409, { error: 'Aucune licence disponible', code: 'licence_indisponible' }));
    await waitFor(() => expect(champ('Licence')).toHaveAccessibleDescription(/Plus aucune licence disponible/));
    expect(within(panneau).getByText('Aucune licence disponible')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/licences')).toHaveLength(2));
  });

  it('409 (aucun identifiant libre) : erreur dans le panneau', async () => {
    const { panneau } = await soumettre(() => reply(409, { error: 'Aucun identifiant disponible pour cette personne' }));
    expect(await within(panneau).findByText('Aucun identifiant disponible pour cette personne')).toBeInTheDocument();
  });

  it('502 avec étape : erreur et consigne de ne pas renvoyer, liste relue, jamais rejoué', async () => {
    const { panneau, fetchMock } = await soumettre(() => reply(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'manager', id: 'id-peut-etre' }));
    expect(await within(panneau).findByText('Étape : manager')).toBeInTheDocument();
    expect(within(panneau).getByText('Ne renvoyez pas la demande')).toBeInTheDocument();
    await waitFor(() => expect(lecturesSuivi(fetchMock)).toBeGreaterThanOrEqual(2));
    await avancer(120_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('session expirée : l’application est prévenue', async () => {
    const surSession = vi.fn();
    const m = monter({ ...base, ecrire: () => reply(401, { error: 'Authentification requise' }), surSession });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(m.user);
    await remplir(m.user);
    await m.user.click(within(panneau).getByRole('button', { name: 'Créer la demande' }));
    await waitFor(() => expect(surSession).toHaveBeenCalled());
  });
});
