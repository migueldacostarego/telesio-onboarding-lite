import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ecritures, lecturesSuivi, reply } from '@/test/helpers';
import { ELOISE, HUGO, actif, avancer, enAttente, monter, tempsSimule, valide } from '@/test/demandes';

tempsSimule();

const MOT_DE_PASSE = 'Kp7m-Xq4r-Tz9w-Hb3n';
const NOUVEAU = 'Rw8c-Nd5t-Yf6v-Gj2s';
const activer = (nom: string) => screen.getByRole('button', { name: `Activer le compte de ${nom}` });
const regenerer = (nom: string) => screen.getByRole('button', { name: `Régénérer le mot de passe de ${nom}` });
const remise = (motDePasseTemporaire = MOT_DE_PASSE, regeneration = false) => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration, motDePasseTemporaire });
const aValider = [valide(ELOISE, { actions: ['activer'] }), enAttente(HUGO, { actions: [] })];

/** Le mot de passe ne doit apparaître nulle part hors du DOM de la boîte : caches, stockage, adresse, titre, console, requêtes. */
function nullePart(client: ReturnType<typeof monter>['client'], fetchMock: ReturnType<typeof monter>['fetchMock'], mot: string) {
  const dans = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (x instanceof Error ? x.message : x)).includes(mot);
  expect(dans(client.getMutationCache().getAll().map((m) => ({ s: m.state, o: m.options })))).toBe(false);
  expect(dans(client.getQueryCache().getAll().map((q) => q.state))).toBe(false);
  expect(dans({ ...localStorage })).toBe(false);
  expect(dans({ ...sessionStorage })).toBe(false);
  expect(window.location.href).not.toContain(mot);
  expect(document.title).not.toContain(mot);
  expect(dans(fetchMock.mock.calls.map((c) => [c[0], c[1]?.body]))).toBe(false);
}

describe('Activer', () => {
  it('confirmation d’abord (rien n’est envoyé), Annuler ferme sans écrire', async () => {
    const { fetchMock, user } = monter({ demandes: aValider, ecrire: () => remise() });
    await screen.findByText('Hugo Lambert');
    expect(screen.queryByRole('button', { name: /Activer le compte de Hugo/ })).not.toBeInTheDocument();

    await user.click(activer(ELOISE.nom));
    const boite = await screen.findByRole('dialog', { name: 'Activer le compte de Éloïse Dupont ?' });
    expect(boite).toHaveTextContent('une seule fois');
    expect(ecritures(fetchMock)).toHaveLength(0);
    await user.click(within(boite).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ecritures(fetchMock)).toHaveLength(0);
  });

  it('confirmer envoie POST /activer {} avec un spinner (rien ne se ferme), puis affiche le mot de passe une seule fois', async () => {
    let finir!: (r: Response) => void;
    const { etat, fetchMock, client, user } = monter({ demandes: aValider, ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    const boite = await screen.findByRole('dialog');
    await user.click(within(boite).getByRole('button', { name: 'Activer le compte' }));

    expect(ecritures(fetchMock)).toEqual([{ url: '/api/demandes/id-eloise/activer', corps: {} }]);
    expect(within(boite).getByRole('button', { name: 'Activation…' })).toBeDisabled();
    expect(within(boite).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(MOT_DE_PASSE)).not.toBeInTheDocument();

    etat.demandes = [actif(ELOISE), enAttente(HUGO, { actions: [] })];
    await act(async () => finir(remise()));
    const mdp = await screen.findByRole('dialog', { name: 'Mot de passe temporaire de Éloïse Dupont' });
    expect(within(mdp).getByText(MOT_DE_PASSE)).toBeInTheDocument();
    expect(mdp).toHaveTextContent('Utilisable dans quelques minutes');
    expect(mdp).toHaveTextContent('plus affiché');
    // Une seule boîte à la fois : la confirmation a laissé la place.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    // Ni cache, ni stockage, ni adresse, ni requête : le DOM seulement.
    await avancer(50);
    nullePart(client, fetchMock, MOT_DE_PASSE);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    // La liste est relue : la ligne passe à Activée, la boîte reste ouverte.
    await waitFor(() => expect(lecturesSuivi(fetchMock)).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(MOT_DE_PASSE)).toBeInTheDocument();
  });

  it('la boîte ne se ferme ni par Échap ni par un clic à côté (pas de perte par accident), seulement par Fermer ; plus rien ensuite', async () => {
    const { fetchMock, client, user } = monter({ demandes: aValider, ecrire: () => remise() });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    await screen.findByText(MOT_DE_PASSE);

    await user.keyboard('{Escape}');
    expect(screen.getByText(MOT_DE_PASSE)).toBeInTheDocument();
    fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!);
    expect(screen.getByText(MOT_DE_PASSE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(MOT_DE_PASSE);
    await avancer(31_000); // l'actualisation n'en rend rien non plus
    expect(document.body.textContent).not.toContain(MOT_DE_PASSE);
    nullePart(client, fetchMock, MOT_DE_PASSE);
  });

  it('Copier met le mot de passe dans le presse-papiers et le dit ; une copie impossible est annoncée', async () => {
    const { user } = monter({ demandes: aValider, ecrire: () => remise() });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    await screen.findByText(MOT_DE_PASSE);

    await user.click(screen.getByRole('button', { name: 'Copier' }));
    expect(await navigator.clipboard.readText()).toBe(MOT_DE_PASSE);
    expect(screen.getByRole('status')).toHaveTextContent('Copié dans le presse-papiers.');

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('refusé'));
    await user.click(screen.getByRole('button', { name: 'Copier' }));
    expect(await screen.findByText(/Copie impossible/)).toBeInTheDocument();
  });

  it('jamais rien dans la console', async () => {
    const espions = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { user } = monter({ demandes: aValider, ecrire: () => remise() });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    await screen.findByText(MOT_DE_PASSE);
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(espions.flatMap((e) => e.mock.calls.flat().map(String)).some((t) => t.includes(MOT_DE_PASSE))).toBe(false);
    espions.forEach((e) => e.mockRestore());
  });

  it.each([
    ['409 avant le jour J', reply(409, { error: 'Le compte ne peut pas être activé avant la date d’arrivée', raison: 'avant_arrivee' }), /avant la date d’arrivée/],
    ['502 avec étape', reply(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'mot_de_passe' }), /Étape : mot_de_passe/],
  ])('%s : erreur dans la ligne, aucun mot de passe, aucune relance automatique', async (_nom, reponse, texte) => {
    const { fetchMock, user } = monter({ demandes: aValider, ecrire: () => reponse.clone() });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('alert')).toHaveTextContent(texte);
    expect(activer(ELOISE.nom)).toBeEnabled();
    await avancer(300_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('réponse sans mot de passe : erreur, aucune boîte de mot de passe', async () => {
    const { user } = monter({ demandes: aValider, ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('aucun mot de passe temporaire reçu');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('session expirée : l’application est prévenue, aucune boîte de mot de passe', async () => {
    const surSession = vi.fn();
    const { user } = monter({ demandes: aValider, ecrire: () => reply(401, { error: 'Authentification requise' }), surSession });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    await waitFor(() => expect(surSession).toHaveBeenCalled());
  });
});

describe('Régénérer', () => {
  const lesActifs = [actif(ELOISE), valide(HUGO, { actions: [] })];

  it('proposé pour un compte Actif seulement quand l’API le propose ; motif choisi dans une liste (obligatoire), POST /regenerer', async () => {
    const { fetchMock, client, user } = monter({ demandes: [actif(ELOISE), actif(HUGO, { actions: [] })], ecrire: () => remise(NOUVEAU, true) });
    await screen.findByText('Hugo Lambert');
    expect(screen.queryByRole('button', { name: /Régénérer le mot de passe de Hugo/ })).not.toBeInTheDocument();

    await user.click(regenerer(ELOISE.nom));
    const boite = await screen.findByRole('dialog', { name: 'Régénérer le mot de passe de Éloïse Dupont ?' });
    expect(within(boite).queryByRole('textbox')).not.toBeInTheDocument();
    const confirmer = within(boite).getByRole('button', { name: 'Régénérer le mot de passe' });
    expect(confirmer).toBeDisabled();
    expect(ecritures(fetchMock)).toHaveLength(0);

    await user.click(within(boite).getByRole('radio', { name: 'Mot de passe perdu' }));
    expect(confirmer).toBeEnabled();
    await user.click(confirmer);
    expect(ecritures(fetchMock)).toEqual([{ url: '/api/demandes/id-eloise/regenerer', corps: { motif: 'code_perdu' } }]);

    const mdp = await screen.findByRole('dialog', { name: 'Nouveau mot de passe temporaire de Éloïse Dupont' });
    expect(within(mdp).getByText(NOUVEAU)).toBeInTheDocument();
    await avancer(50);
    nullePart(client, fetchMock, NOUVEAU);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('les trois motifs de l’API, rien d’autre', async () => {
    const { user } = monter({ demandes: lesActifs, ecrire: () => remise(NOUVEAU, true) });
    await screen.findByText('Hugo Lambert');
    await user.click(regenerer(ELOISE.nom));
    const boite = await screen.findByRole('dialog');
    expect(within(boite).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['code_perdu', 'code_refuse', 'autre']);
  });

  it('Annuler ne règle rien ; une erreur 409 (onboarding terminé) s’affiche dans la ligne', async () => {
    const { fetchMock, user } = monter({ demandes: lesActifs, ecrire: () => reply(409, { error: 'Action impossible : l’onboarding est terminé', raison: 'onboarding_termine' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(regenerer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ecritures(fetchMock)).toHaveLength(0);

    await user.click(regenerer(ELOISE.nom));
    const boite = await screen.findByRole('dialog');
    expect(within(boite).getByRole('radio', { name: 'Mot de passe perdu' })).not.toBeChecked(); // repart vide
    await user.click(within(boite).getByRole('radio', { name: 'Autre raison' }));
    await user.click(within(boite).getByRole('button', { name: 'Régénérer le mot de passe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('onboarding est terminé');
    expect(ecritures(fetchMock)).toEqual([{ url: '/api/demandes/id-eloise/regenerer', corps: { motif: 'autre' } }]);
  });
});

describe('passage à Terminé : seul, par POST /terminer', () => {
  const complet = (o = {}) => actif(ELOISE, { onboarding: { motDePasse: true, authenticator: true, termine: true }, ...o });
  const URL_TERMINER = '/api/demandes/id-eloise/terminer';

  it('appelé une fois pour un compte Actif dont l’API dit que l’onboarding est complet, puis la liste est relue et montre Terminée', async () => {
    const { etat, fetchMock } = monter({
      demandes: [complet(), enAttente(HUGO, { actions: [] })],
      ecrire: () => {
        etat.demandes = [{ ...complet(), statut: 'Terminé', etape: 4, actions: [], onboarding: undefined }, enAttente(HUGO, { actions: [] })];
        return reply(200, { id: ELOISE.id, statut: 'Terminé' });
      },
    });
    await screen.findByText('Hugo Lambert');
    await waitFor(() => expect(ecritures(fetchMock)).toEqual([{ url: URL_TERMINER, corps: {} }]));
    const ligne = await screen.findByRole('row', { name: /Éloïse Dupont/ });
    await waitFor(() => expect(within(ligne).getByText('Terminée')).toBeInTheDocument());
    await avancer(90_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('pas d’appel si l’onboarding est incomplet, si la lecture a échoué, ou si l’API ne propose pas regenerer (droit activer absent)', async () => {
    const { fetchMock } = monter({
      demandes: [
        actif(ELOISE),
        actif(HUGO, { onboarding: { verification: 'echec' } }),
        actif({ id: 'id-sans-droit', nom: 'Anna Martin' }, { actions: [], onboarding: { motDePasse: true, authenticator: true, termine: true } }),
        valide({ id: 'id-valide', nom: 'Luc Bernard' }),
      ],
      ecrire: () => reply(200, {}),
    });
    await screen.findByText('Hugo Lambert');
    await avancer(60_000);
    expect(ecritures(fetchMock)).toHaveLength(0);
  });

  it('un 409 (le serveur n’est pas encore d’accord) est silencieux et retenté aux listes suivantes, sans dépasser 5 essais', async () => {
    const { fetchMock } = monter({ demandes: [complet()], ecrire: () => reply(409, { error: 'Onboarding non terminé', code: 'onboarding_non_termine' }) });
    await screen.findByText('Éloïse Dupont');
    await avancer(10 * 31_000);
    expect(ecritures(fetchMock).filter((e) => e.url === URL_TERMINER)).toHaveLength(5);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
