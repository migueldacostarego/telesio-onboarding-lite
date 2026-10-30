import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ecritures, lecturesSuivi, reply, stubBureau } from '@/test/helpers';
import { ELOISE, HUGO, avancer, enAttente, monter, tempsSimule, valide } from '@/test/demandes';

tempsSimule();

const valider = (nom: string) => screen.getByRole('button', { name: `Valider la demande de ${nom}` });
const refuser = (nom: string) => screen.getByRole('button', { name: `Refuser la demande de ${nom}` });
const POST_ELOISE = '/api/demandes/id-eloise/valider';
const introuvable = () => reply(404, { error: 'Demande introuvable' });

describe('Valider', () => {
  it('POST sur la bonne adresse, spinner sur le bouton, rien d’autre de cliquable sur la ligne, puis la liste est relue', async () => {
    let finir!: (r: Response) => void;
    const { etat, fetchMock, user } = monter({ ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    expect(lecturesSuivi(fetchMock)).toBe(1);

    await user.click(valider(ELOISE.nom));
    expect(ecritures(fetchMock)).toEqual([{ url: POST_ELOISE, corps: {} }]);
    expect(valider(ELOISE.nom)).toHaveAttribute('aria-busy', 'true');
    expect(valider(ELOISE.nom)).toHaveTextContent('Validation…');
    expect(valider(ELOISE.nom)).toBeDisabled();
    expect(refuser(ELOISE.nom)).toBeDisabled();
    // Les autres lignes ne sont pas touchées.
    expect(valider(HUGO.nom)).toBeEnabled();
    expect(refuser(HUGO.nom)).toBeEnabled();

    // Un second clic ne repart pas.
    await user.click(valider(ELOISE.nom));
    expect(ecritures(fetchMock)).toHaveLength(1);

    etat.demandes = [valide(ELOISE), enAttente(HUGO)];
    await act(async () => finir(reply(200, { id: ELOISE.id, statut: 'Validé' })));
    await waitFor(() => expect(lecturesSuivi(fetchMock)).toBe(2));
    const ligne = await screen.findByRole('row', { name: /Éloïse Dupont/ });
    await waitFor(() => expect(within(ligne).getByText('Validée')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^(Valider|Refuser) la demande de Éloïse Dupont/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ne propose que ce que l’API propose : rien sans `actions` (droit manquant)', async () => {
    monter({ demandes: [enAttente(ELOISE, { actions: [] }), enAttente(HUGO)], ecrire: () => reply(200, {}) });
    await screen.findByText('Hugo Lambert');
    expect(screen.queryByRole('button', { name: /^(Valider|Refuser) la demande de Éloïse Dupont/ })).not.toBeInTheDocument();
    expect(valider(HUGO.nom)).toBeInTheDocument();
  });

  it('l’état d’une ligne survit à la recherche et au filtre qui démontent la ligne : pas de second clic possible', async () => {
    let finir!: (r: Response) => void;
    const { etat, fetchMock, user } = monter({ ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher par nom' }), 'hugo');
    expect(screen.queryByText('Éloïse Dupont')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Rechercher par nom' }));
    expect(valider(ELOISE.nom)).toHaveAttribute('aria-busy', 'true');
    expect(valider(ELOISE.nom)).toBeDisabled();
    expect(ecritures(fetchMock)).toHaveLength(1);

    etat.demandes = [valide(ELOISE), enAttente(HUGO)];
    await act(async () => finir(reply(200, {})));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^(Valider|Refuser) la demande de Éloïse Dupont/ })).not.toBeInTheDocument());
  });

  it('deux lignes en même temps : chacune garde son état', async () => {
    const attente: Record<string, (r: Response) => void> = {};
    const { fetchMock, user } = monter({ ecrire: (url) => new Promise<Response>((r) => (attente[url] = r)) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await user.click(valider(HUGO.nom));
    expect(ecritures(fetchMock).map((e) => e.url)).toEqual([POST_ELOISE, '/api/demandes/id-hugo/valider']);
    expect(valider(ELOISE.nom)).toBeDisabled();
    expect(valider(HUGO.nom)).toBeDisabled();

    await act(async () => attente['/api/demandes/id-hugo/valider']!(reply(409, { error: 'Action impossible dans le statut actuel' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Action impossible dans le statut actuel');
    expect(valider(HUGO.nom)).toBeEnabled();
    expect(valider(ELOISE.nom)).toBeDisabled();
  });
});

describe('compte pas encore répliqué (404 sur valider)', () => {
  it('affiche « Compte en cours de création », verrouille la ligne et réessaie seul', async () => {
    let appels = 0;
    const { etat, fetchMock, user } = monter({ ecrire: () => (++appels === 1 ? introuvable() : reply(200, {})) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));

    expect(await screen.findByText('Compte en cours de création')).toBeInTheDocument();
    expect(valider(ELOISE.nom)).toBeDisabled();
    expect(refuser(ELOISE.nom)).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(ecritures(fetchMock)).toHaveLength(1);

    await avancer(4_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
    etat.demandes = [valide(ELOISE), enAttente(HUGO)];
    await avancer(1_500);
    expect(ecritures(fetchMock)).toHaveLength(2);
    await waitFor(() => expect(screen.queryByText('Compte en cours de création')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('button', { name: /^(Valider|Refuser) la demande de Éloïse Dupont/ })).not.toBeInTheDocument());
  });

  it('abandonne après une minute et six essais : ApiErrorAlert dans la ligne, boutons rendus, plus aucun essai', async () => {
    const { fetchMock, user } = monter({ ecrire: introuvable });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await avancer(60_000);
    expect(ecritures(fetchMock)).toHaveLength(7);
    expect(await screen.findByRole('alert')).toHaveTextContent('Demande introuvable');
    expect(screen.queryByText('Compte en cours de création')).not.toBeInTheDocument();
    expect(valider(ELOISE.nom)).toBeEnabled();

    await avancer(120_000);
    expect(ecritures(fetchMock)).toHaveLength(7);
  });

  it('un 404 sur refuser n’est jamais rejoué (c’est une suppression)', async () => {
    const { fetchMock, user } = monter({ ecrire: introuvable });
    await screen.findByText('Hugo Lambert');
    await user.click(refuser(ELOISE.nom));
    await user.type(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Candidat retiré');
    await user.click(screen.getByRole('button', { name: 'Confirmer le refus' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demande introuvable');
    await avancer(120_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('abandonne si la demande disparaît de la liste (traitée ailleurs) : le prochain essai ne part pas', async () => {
    const { etat, fetchMock, client, user } = monter({ ecrire: introuvable });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    expect(await screen.findByText('Compte en cours de création')).toBeInTheDocument();

    etat.demandes = [enAttente(HUGO)];
    await act(() => client.invalidateQueries({ queryKey: ['suivi'] })); // actualisation
    await waitFor(() => expect(screen.queryByText('Éloïse Dupont')).not.toBeInTheDocument());
    await avancer(60_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('démonté : plus aucun essai', async () => {
    const { fetchMock, user, unmount } = monter({ ecrire: introuvable });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await screen.findByText('Compte en cours de création');
    unmount();
    await avancer(120_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
  });
});

describe('202 licence_en_cours', () => {
  const enCours = () => reply(202, { message: 'Licence en cours d’attribution, revalidez dans une minute', code: 'licence_en_cours', etape: 'licence_verification' });

  it('affiche « Licence en cours d’attribution » (pas une erreur) et revalide seul après 60 s', async () => {
    let appels = 0;
    // Au second appel, le serveur valide : la liste relue le dit.
    const { etat, fetchMock, user } = monter({
      ecrire: () => {
        if (++appels === 1) return enCours();
        etat.demandes = [valide(ELOISE), enAttente(HUGO)];
        return reply(200, {});
      },
    });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));

    expect(await screen.findByText('Licence en cours d’attribution')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(valider(ELOISE.nom)).toBeDisabled();
    expect(refuser(ELOISE.nom)).toBeDisabled();

    await avancer(59_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
    await avancer(1_500);
    expect(ecritures(fetchMock).map((e) => e.url)).toEqual([POST_ELOISE, POST_ELOISE]);
    await waitFor(() => expect(screen.queryByText('Licence en cours d’attribution')).not.toBeInTheDocument());
  });

  it('cinq revalidations au plus, puis un avertissement et la main rendue', async () => {
    const { fetchMock, user } = monter({ ecrire: enCours });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await avancer(5 * 60_000 + 1_000);
    expect(ecritures(fetchMock)).toHaveLength(6);
    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Licence en cours d’attribution');
    expect(alerte).toHaveTextContent('revalidez dans quelques minutes');
    expect(valider(ELOISE.nom)).toBeEnabled();
    await avancer(120_000);
    expect(ecritures(fetchMock)).toHaveLength(6);
  });

  it('annulée si la demande n’offre plus `approuver` à l’actualisation (validée par quelqu’un d’autre)', async () => {
    const { etat, fetchMock, user } = monter({ ecrire: enCours });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await screen.findByText('Licence en cours d’attribution');

    etat.demandes = [valide(ELOISE), enAttente(HUGO)];
    await avancer(30_000);
    await waitFor(() => expect(screen.queryByText('Licence en cours d’attribution')).not.toBeInTheDocument());
    await avancer(120_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
  });
});

describe('Refuser', () => {
  it('boîte de dialogue : motif obligatoire (espaces seuls refusés), puis confirmation, motif envoyé dans le corps seulement', async () => {
    let finir!: (r: Response) => void;
    const { etat, fetchMock, user } = monter({ ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    const urlAvant = window.location.href;

    await user.click(refuser(ELOISE.nom));
    const boite = await screen.findByRole('dialog', { name: 'Refuser la demande de Éloïse Dupont ?' });
    const confirmer = within(boite).getByRole('button', { name: 'Confirmer le refus' });
    expect(confirmer).toBeDisabled();
    expect(ecritures(fetchMock)).toHaveLength(0);

    await user.type(within(boite).getByRole('textbox', { name: /Motif du refus/ }), '   ');
    expect(confirmer).toBeDisabled();
    await user.type(within(boite).getByRole('textbox', { name: /Motif du refus/ }), 'Poste supprimé  ');
    expect(confirmer).toBeEnabled();
    await user.click(confirmer);

    expect(ecritures(fetchMock)).toEqual([{ url: '/api/demandes/id-eloise/refuser', corps: { motif: 'Poste supprimé' } }]);
    // Rien du motif dans une adresse, ni dans le stockage du navigateur.
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('Poste'))).toBe(true);
    expect(window.location.href).toBe(urlAvant);
    expect(JSON.stringify({ ...localStorage })).not.toContain('Poste');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('Poste');

    // Pendant le refus : la boîte ne se ferme ni par Échap, ni par Annuler, et la ligne est verrouillée.
    expect(within(boite).getByRole('button', { name: 'Refus en cours…' })).toBeDisabled();
    expect(within(boite).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    etat.demandes = [enAttente(HUGO)];
    await act(async () => finir(reply(200, { id: ELOISE.id })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Éloïse Dupont')).not.toBeInTheDocument());
    expect(lecturesSuivi(fetchMock)).toBe(2);
  });

  it('Annuler (et Échap) ferment sans rien envoyer, et la boîte repart vide', async () => {
    const { fetchMock, user } = monter({ ecrire: () => reply(200, {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(refuser(ELOISE.nom));
    await user.type(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Brouillon');
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ecritures(fetchMock)).toHaveLength(0);

    await user.click(refuser(ELOISE.nom));
    expect(await screen.findByRole('textbox', { name: /Motif du refus/ })).toHaveValue('');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ecritures(fetchMock)).toHaveLength(0);
  });

  it('le motif est limité à 500 caractères', async () => {
    const { user } = monter({ ecrire: () => reply(200, {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(refuser(ELOISE.nom));
    expect(await screen.findByRole('textbox', { name: /Motif du refus/ })).toHaveAttribute('maxlength', '500');
  });

  it('la boîte se ferme si la demande ne se refuse plus (traitée ailleurs, actualisation)', async () => {
    const { etat, user } = monter({ ecrire: () => reply(200, {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(refuser(ELOISE.nom));
    await screen.findByRole('dialog');
    etat.demandes = [valide(ELOISE), enAttente(HUGO)];
    await avancer(30_000);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('erreurs de l’API : ApiErrorAlert dans la ligne', () => {
  const cas: [string, Response, RegExp[]][] = [
    ['403 droit_manquant', reply(403, { error: 'Accès refusé', code: 'droit_manquant' }), [/Accès refusé/]],
    ['409', reply(409, { error: 'Action impossible dans le statut actuel', statut: 'Validé' }), [/Action impossible dans l’état actuel/, /Action impossible dans le statut actuel/]],
    ['502 avec étape', reply(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'dossier' }), [/Une étape a échoué/, /Étape : dossier/]],
  ];

  it.each(cas)('%s', async (_nom, reponse, attendus) => {
    const { fetchMock, user } = monter({ ecrire: () => reponse.clone() });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    const alerte = await screen.findByRole('alert');
    for (const a of attendus) expect(alerte).toHaveTextContent(a);
    // Dans la ligne de la demande (sous elle), pas ailleurs ; la ligne suivante n'a rien.
    const ligne = screen.getByRole('row', { name: /Éloïse Dupont/ });
    expect(ligne.nextElementSibling).toContainElement(alerte);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // La ligne est rendue : on peut réessayer.
    expect(valider(ELOISE.nom)).toBeEnabled();
    expect(refuser(ELOISE.nom)).toBeEnabled();
    // Après une erreur, l'état réel (validée ou refusée ailleurs, reprise partielle) est relu.
    await waitFor(() => expect(lecturesSuivi(fetchMock)).toBe(2));

    await user.click(screen.getByRole('button', { name: 'Fermer ce message' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('une nouvelle tentative efface l’erreur', async () => {
    let appels = 0;
    const { user } = monter({ ecrire: () => (++appels === 1 ? reply(409, { error: 'Action impossible dans le statut actuel' }) : new Promise<Response>(() => {})) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await screen.findByRole('alert');
    await user.click(valider(ELOISE.nom));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(valider(ELOISE.nom)).toHaveAttribute('aria-busy', 'true');
  });

  it('une erreur du refus ferme la boîte et s’affiche dans la ligne', async () => {
    const { user } = monter({ ecrire: () => reply(403, { error: 'Accès refusé', code: 'droit_manquant' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(refuser(ELOISE.nom));
    await user.type(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Raison');
    await user.click(screen.getByRole('button', { name: 'Confirmer le refus' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('alert')).toHaveTextContent('Accès refusé');
  });
});

describe('session expirée', () => {
  it('401 sur valider : l’application est prévenue (écran de reconnexion), aucune erreur de ligne', async () => {
    const surSession = vi.fn();
    const { user } = monter({ ecrire: () => reply(401, { error: 'Authentification requise' }), surSession });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await waitFor(() => expect(surSession).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('réponse hors JSON (redirection vers la connexion) sur refuser : même chose', async () => {
    const surSession = vi.fn();
    const { user } = monter({ ecrire: () => new Response('<html>connexion</html>', { status: 200, headers: { 'content-type': 'text/html' } }), surSession });
    await screen.findByText('Hugo Lambert');
    await user.click(refuser(ELOISE.nom));
    await user.type(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Raison');
    await user.click(screen.getByRole('button', { name: 'Confirmer le refus' }));
    await waitFor(() => expect(surSession).toHaveBeenCalled());
  });
});

describe('mobile : les mêmes actions dans les cartes', () => {
  beforeEach(() => stubBureau(false));

  it('valider dans une carte, erreur dans la carte', async () => {
    const { user } = monter({ ecrire: () => reply(409, { error: 'Action impossible dans le statut actuel' }) });
    await screen.findByText('Hugo Lambert');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(valider(ELOISE.nom));
    const alerte = await screen.findByRole('alert');
    const carte = alerte.closest('li');
    expect(carte).toHaveTextContent('Éloïse Dupont');
    expect(carte).not.toHaveTextContent('Hugo Lambert');
  });
});
