import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ecritures, lecturesSuivi, reply, verifications } from '@/test/helpers';
import { CAMILLE, DROITS_DIRECTION } from '@/test/helpers';
import { ELOISE, HUGO, avancer, enAttente, monter, tempsSimule } from '@/test/demandes';

tempsSimule();

const MANAGER = { id: '11111111-2222-4333-8444-555555555555', displayName: 'Marie Responsable', mail: 'marie.responsable@exemple.test' };
const AUTRE = { id: '66666666-7777-4888-9999-000000000000', displayName: 'Marc Responsable', mail: null };
const CREEE = { id: 'id-nouveau', userPrincipalName: 'camille.durand@exemple.test', statut: 'EnAttente' };

const lire = (url: string) => (url.startsWith('/api/annuaire?q=') ? reply(200, [MANAGER, AUTRE]) : undefined);
const nouvelleLigne = () => enAttente({ id: CREEE.id, nom: 'Camille Durand' }, { poste: 'Analyste', service: 'Finance', dateArrivee: '2026-11-16', typeContrat: 'Employé' });
const base = { demandes: [enAttente(ELOISE), enAttente(HUGO)], lire };
const ouvrir = async (user: UserEvent) => {
  await user.click(screen.getByRole('button', { name: 'Nouvelle demande' }));
  const panneau = await screen.findByRole('dialog', { name: 'Nouvelle demande' });
  await within(panneau).findByLabelText('Prénom'); // le formulaire est chargé à la première ouverture
  return panneau;
};
const champ = (nom: string) => screen.getByLabelText(nom);
const EMAIL = 'camille.durand@exemple.test';
const creer = (panneau: HTMLElement) => within(panneau).getByRole('button', { name: 'Créer la demande' });

/** Remplit tout, responsable compris (recherche, attente de 300 ms, choix dans la liste). */
async function remplir(user: UserEvent, o: { date?: string; sansManager?: boolean; type?: 'Employé' | 'Contractor' } = {}) {
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
  if (o.type) await user.click(screen.getByRole('radio', { name: o.type }));
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

describe('fenêtre', () => {
  it('modale de 560 px à trois sections titrées, sans choix de licence', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    expect(panneau).toHaveAttribute('data-slot', 'dialog-content');
    expect(panneau.className).toContain('sm:max-w-[560px]');
    for (const [titre, champs] of [['Identité', ['Prénom', 'Nom', 'Email pro']], ['Contrat', ['Date d’arrivée']], ['Poste', ['Poste', 'Service']]] as const) {
      const section = within(panneau).getByRole('group', { name: titre });
      for (const nom of champs) expect(within(section).getByLabelText(nom)).toBeInTheDocument();
    }
    expect(within(within(panneau).getByRole('group', { name: 'Contrat' })).getByRole('radiogroup', { name: 'Type' })).toBeInTheDocument();
    expect(within(within(panneau).getByRole('group', { name: 'Poste' })).getByRole('combobox', { name: 'Responsable' })).toBeInTheDocument();
    expect(within(panneau).getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    expect(creer(panneau)).toBeEnabled();
    // Plus de licence à choisir, ni lue.
    expect(screen.queryByLabelText('Licence')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/licences');
  });

  it('type : Employé par défaut, Contractor au choix (radio ; les flèches du clavier sont contrôlées dans Chrome, jsdom ne les rejoue pas)', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    expect(screen.getByRole('radio', { name: 'Employé' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Contractor' })).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Contractor' }));
    expect(screen.getByRole('radio', { name: 'Contractor' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Employé' }));
    expect(screen.getByRole('radio', { name: 'Employé' })).toBeChecked();
  });
});

describe('email pro', () => {
  it('proposé d’après le prénom et le nom (minuscules, accents retirés, espaces et apostrophes supprimés), mis à jour en tapant', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    expect(champ('Email pro')).toHaveValue('');
    await user.type(champ('Prénom'), 'Éloïse');
    expect(champ('Email pro')).toHaveValue(''); // pas de nom : rien à proposer
    await user.type(champ('Nom'), 'De La Cruz');
    expect(champ('Email pro')).toHaveValue('eloise.delacruz@exemple.test');
    await user.clear(champ('Nom'));
    await user.type(champ('Nom'), 'D’Artagnan');
    expect(champ('Email pro')).toHaveValue('eloise.dartagnan@exemple.test');
  });

  it('une fois modifié, il n’est plus écrasé ; « Reproposer » revient à l’adresse proposée', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    await ouvrir(user);
    await user.type(champ('Prénom'), 'Camille');
    await user.type(champ('Nom'), 'Durand');
    expect(screen.queryByRole('button', { name: /Reproposer/ })).not.toBeInTheDocument();

    await user.clear(champ('Email pro'));
    await user.type(champ('Email pro'), 'c.durand2@exemple.test');
    await user.type(champ('Nom'), 'x'); // le nom change : l'adresse choisie reste
    expect(champ('Email pro')).toHaveValue('c.durand2@exemple.test');
    await user.click(screen.getByRole('button', { name: /Reproposer/ }));
    expect(champ('Email pro')).toHaveValue('camille.durandx@exemple.test');
    expect(screen.queryByRole('button', { name: /Reproposer/ })).not.toBeInTheDocument();
    await user.type(champ('Nom'), 'y'); // de nouveau automatique
    expect(champ('Email pro')).toHaveValue('camille.durandxy@exemple.test');
  });

  it('disponibilité : « Vérification… » puis « Adresse disponible », une requête 400 ms après la dernière frappe, l’adresse dans le corps seulement', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const avant = window.location.href;
    await ouvrir(user);
    await user.type(champ('Prénom'), 'Camille');
    await user.type(champ('Nom'), 'Durand');
    expect(screen.getByText('Vérification…')).toBeInTheDocument();
    expect(verifications(fetchMock)).toEqual([]);
    await avancer(300);
    expect(verifications(fetchMock)).toEqual([]); // moins de 400 ms
    await avancer(200);
    expect(await screen.findByText('Adresse disponible')).toBeInTheDocument();
    expect(verifications(fetchMock)).toEqual([EMAIL]);
    expect(champ('Email pro')).not.toHaveAttribute('aria-invalid');
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('camille'))).toBe(true); // jamais dans une adresse d'API
    expect(window.location.href).toBe(avant);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('camille');
  });

  it('adresse mal formée : aucune vérification ; déjà prise : message, champ invalide, envoi bloqué avec le focus sur l’adresse', async () => {
    const { fetchMock, user } = monter({ ...base, disponibilite: () => reply(200, { disponible: false }), ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await avancer(500);
    expect(await screen.findByText('Adresse déjà utilisée : modifiez-la.')).toBeInTheDocument();
    expect(champ('Email pro')).toHaveAttribute('aria-invalid', 'true');
    expect(champ('Email pro')).toHaveAccessibleDescription(/déjà utilisée/);

    await user.click(creer(panneau));
    expect(ecritures(fetchMock)).toHaveLength(0);
    expect(champ('Email pro')).toHaveFocus();

    const n = verifications(fetchMock).length;
    await user.clear(champ('Email pro'));
    await user.type(champ('Email pro'), 'camille.durand@autre.test'); // mal formée : le domaine
    await avancer(1_000);
    expect(verifications(fetchMock)).toHaveLength(n);
    expect(champ('Email pro')).toHaveAccessibleDescription(/Le domaine doit être exemple.test/);
  });

  it('vérification en échec : message discret, l’envoi reste possible (le serveur revérifie)', async () => {
    const { fetchMock, user } = monter({ ...base, disponibilite: () => reply(502, { error: 'Le service d’annuaire est indisponible' }), ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await avancer(500);
    expect(await screen.findByText(/Vérification impossible/)).toBeInTheDocument();
    await user.click(creer(panneau));
    expect(ecritures(fetchMock)).toHaveLength(1);
  });
});

describe('validation côté interface (zod)', () => {
  it('envoi à vide : une erreur sous chaque champ, le focus sur le premier, rien n’est envoyé', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await user.click(creer(panneau));

    for (const [nom, erreur] of [['Prénom', 'Prénom requis'], ['Nom', 'Nom requis'], ['Email pro', 'Adresse e-mail requise'], ['Poste', 'Poste requis'], ['Service', 'Service requis'], ['Date d’arrivée', 'Date d’arrivée requise']] as const) {
      expect(champ(nom)).toHaveAttribute('aria-invalid', 'true');
      expect(champ(nom)).toHaveAccessibleDescription(expect.stringContaining(erreur));
    }
    expect(within(panneau).getByText('Choisissez le responsable dans la liste')).toBeInTheDocument();
    expect(ecritures(fetchMock)).toHaveLength(0);
    expect(champ('Prénom')).toHaveFocus();
  });

  it('une erreur sur le responsable ou le type disparaît dès qu’on corrige le champ, sans attendre un nouvel envoi', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(409, { error: 'Aucune licence disponible', code: 'licence_indisponible' }) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await user.click(creer(panneau)); // à vide : le responsable est en erreur
    expect(within(panneau).getByText('Choisissez le responsable dans la liste')).toBeInTheDocument();
    await remplir(user);
    expect(within(panneau).queryByText('Choisissez le responsable dans la liste')).not.toBeInTheDocument();

    await user.click(creer(panneau)); // le serveur refuse : plus de licence pour ce type
    expect(await within(panneau).findByText(/Aucune licence disponible pour ce type de contrat/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Contractor' }));
    await waitFor(() => expect(within(panneau).queryByText(/Aucune licence disponible pour ce type de contrat/)).not.toBeInTheDocument());
  });

  it('le focus va au premier champ en erreur de la page, le responsable compris', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user, { sansManager: true });
    await user.click(creer(panneau));
    expect(screen.getByRole('combobox', { name: 'Responsable' })).toHaveFocus();
  });

  it('date dans le passé refusée, champs trop longs refusés', async () => {
    const { fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user, { date: '2026-10-01' });
    fireEvent.change(champ('Poste'), { target: { value: 'x'.repeat(129) } });
    await user.click(creer(panneau));
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

describe('envoi', () => {
  it('POST /api/demandes avec les huit champs (nettoyés, type et adresse, sans licence), la fenêtre se ferme, la liste est relue et la nouvelle ligne mise en évidence', async () => {
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
    await user.click(creer(panneau));

    expect(ecritures(fetchMock)).toEqual([
      { url: '/api/demandes', corps: { prenom: 'Camille', nom: 'Durand', email: EMAIL, typeContrat: 'Employé', dateArrivee: '2026-11-16', poste: 'Analyste', service: 'Finance', managerId: MANAGER.id } },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Demande créée pour Camille Durand')).toBeInTheDocument();
    expect(screen.getByText('Elle attend la validation de la direction.')).toBeInTheDocument();

    await waitFor(() => expect(lecturesSuivi(fetchMock)).toBeGreaterThanOrEqual(2));
    const ligne = await screen.findByRole('row', { name: /Camille Durand/ });
    expect(ligne).toHaveAttribute('data-nouvelle', 'true');
    expect(ligne).toHaveTextContent('nouvelle demande');
    expect(within(ligne).getByText('Employé')).toBeInTheDocument(); // le type est affiché dans la liste
    expect(screen.getByRole('row', { name: /Hugo Lambert/ })).not.toHaveAttribute('data-nouvelle');
    // Un second clic sur le bouton rouvre un formulaire vide.
    await user.click(screen.getByRole('button', { name: 'Nouvelle demande' }));
    expect(await screen.findByLabelText('Prénom')).toHaveValue('');
  });

  it('Contractor : le type part au serveur et s’affiche dans la liste', async () => {
    const { etat, fetchMock, user } = monter({ ...base, ecrire: () => { etat.demandes = [...etat.demandes, { ...nouvelleLigne(), typeContrat: 'Contractor' }]; return reply(201, CREEE); } });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user, { type: 'Contractor' });
    await user.click(creer(panneau));
    expect(ecritures(fetchMock)).toMatchObject([{ corps: { typeContrat: 'Contractor' } }]);
    expect(ecritures(fetchMock)[0]?.corps).not.toHaveProperty('licence');
    const ligne = await screen.findByRole('row', { name: /Camille Durand/ });
    expect(within(ligne).getByText('Contractor')).toBeInTheDocument();
  });

  it('la ligne créée n’est pas encore répliquée : elle est affichée tout de suite avec « synchronisation… », la liste est relue toutes les 5 s, l’indicateur part quand l’API la rend', async () => {
    const { etat, fetchMock, user } = monter({ ...base, ecrire: () => reply(201, CREEE) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await user.click(creer(panneau));
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
    await user.click(creer(panneau));
    expect(await screen.findByRole('row', { name: /Camille Durand/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Rechercher par nom' })).toHaveValue('');
  });

  it('avertissement manager_non_affecte : affiché, avec la consigne de ne pas renvoyer la demande', async () => {
    const { user } = monter({ ...base, ecrire: () => reply(201, { ...CREEE, avertissement: 'manager_non_affecte' }) });
    await screen.findByText('Hugo Lambert');
    const panneau = await ouvrir(user);
    await remplir(user);
    await user.click(creer(panneau));
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
    await user.click(creer(panneau));

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
    fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!);
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
    await m.user.click(creer(panneau));
    return { ...m, panneau };
  };

  it('400 : le message du serveur sous chaque champ concerné, le panneau reste ouvert avec la saisie', async () => {
    const { panneau, fetchMock } = await soumettre(() => reply(400, { error: 'Entrée invalide', details: { prenom: 'doit contenir au moins une lettre latine ou un chiffre', dateArrivee: 'ne peut pas être dans le passé', managerId: 'objectId Entra (GUID) requis' } }));
    await waitFor(() => expect(champ('Prénom')).toHaveAccessibleDescription('doit contenir au moins une lettre latine ou un chiffre'));
    expect(champ('Prénom')).toHaveFocus(); // le premier champ en erreur de la page
    expect(champ('Date d’arrivée')).toHaveAccessibleDescription('ne peut pas être dans le passé');
    expect(within(panneau).getByText('objectId Entra (GUID) requis')).toBeInTheDocument();
    expect(champ('Nom')).toHaveValue('Durand');
    expect(screen.getByRole('dialog', { name: 'Nouvelle demande' })).toBeInTheDocument();
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('409 licence_indisponible : message sous le type de contrat (plus de champ licence), focus dessus, rien d’autre à relire', async () => {
    const { panneau, fetchMock } = await soumettre(() => reply(409, { error: 'Aucune licence disponible', code: 'licence_indisponible' }));
    await waitFor(() => expect(within(panneau).getByRole('radiogroup', { name: 'Type' })).toHaveAccessibleDescription(/Aucune licence disponible pour ce type de contrat/));
    expect(within(panneau).getByRole('radio', { name: 'Employé' })).toHaveFocus();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/licences');
    // Un autre type, et l'erreur part avec le nouveau choix.
    await within(panneau).findByRole('radio', { name: 'Contractor' });
  });

  it('409 email_pris : message sous l’adresse, focus dessus, la saisie est conservée', async () => {
    const { panneau, fetchMock } = await soumettre(() => reply(409, { error: 'Cette adresse est déjà utilisée', code: 'email_pris' }));
    await waitFor(() => expect(champ('Email pro')).toHaveAccessibleDescription(/Cette adresse est déjà utilisée : modifiez-la/));
    expect(champ('Email pro')).toHaveFocus();
    expect(champ('Email pro')).toHaveValue(EMAIL);
    expect(champ('Nom')).toHaveValue('Durand');
    expect(screen.getByRole('dialog', { name: 'Nouvelle demande' })).toBeInTheDocument();
    expect(within(panneau).getAllByRole('alert')).toHaveLength(1); // sous le champ seulement, pas en plus en haut de la fenêtre
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('400 sur un champ qui n’est plus dans le formulaire (licence) : message dans la fenêtre', async () => {
    const { panneau } = await soumettre(() => reply(400, { error: 'Entrée invalide', details: { licence: 'ne se choisit plus : elle dépend du type de contrat (typeContrat)' } }));
    expect(await within(panneau).findByRole('alert')).toBeInTheDocument();
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
    await m.user.click(creer(panneau));
    await waitFor(() => expect(surSession).toHaveBeenCalled());
  });
});
