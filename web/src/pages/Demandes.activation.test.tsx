import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ecritures, lecturesSuivi, reply } from '@/test/helpers';
import { ELOISE, HUGO, actif, avancer, choisir, enAttente, monter, tempsSimule, valide } from '@/test/demandes';

tempsSimule();

const MOT_DE_PASSE = 'Kp7m-Xq4r-Tz9w-Hb3n';
const NOUVEAU = 'Rw8c-Nd5t-Yf6v-Gj2s';
const MINUTEURS_AU_REPOS_MAX = 20;
const activer = (nom: string) => screen.getByRole('button', { name: `Activer le compte de ${nom}` });
const remise = (motDePasseTemporaire = MOT_DE_PASSE, regeneration = false) => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration, motDePasseTemporaire });
const aValider = [valide(ELOISE, { actions: ['activer'] }), enAttente(HUGO, { actions: [] })];

/** Ouvre la confirmation d'Éloïse et la valide : activation, ou régénération pour « mot de passe perdu ». */
async function lancer(user: UserEvent, action: 'activer' | 'régénérer') {
  if (action === 'activer') {
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    return;
  }
  await choisir(user, ELOISE.nom, `Régénérer le mot de passe de ${ELOISE.nom}`);
  const boite = await screen.findByRole('dialog');
  await user.click(within(boite).getByRole('radio', { name: 'Mot de passe perdu' }));
  await user.click(within(boite).getByRole('button', { name: 'Régénérer le mot de passe' }));
}

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
    expect(screen.queryByRole('button', { name: /^Activer le compte de Hugo/ })).not.toBeInTheDocument();

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
    expect(screen.queryByDisplayValue(MOT_DE_PASSE)).not.toBeInTheDocument();

    etat.demandes = [actif(ELOISE), enAttente(HUGO, { actions: [] })];
    await act(async () => finir(remise()));
    const mdp = await screen.findByRole('dialog', { name: 'Mot de passe temporaire de Éloïse Dupont' });
    expect(within(mdp).getByDisplayValue(MOT_DE_PASSE)).toBeInTheDocument();
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
    expect(screen.getByDisplayValue(MOT_DE_PASSE)).toBeInTheDocument();
  });

  it('requête longue : aucun minuteur de 0 ms en boucle (mutation sans observateur), et plus rien en cache à la fin', async () => {
    let finir!: (r: Response) => void;
    const { client, user } = monter({ demandes: aValider, ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    await avancer(10_000); // se bloquerait si TanStack réarmait un minuteur de 0 ms sans fin
    // Au repos, une poignée de minuteurs (actualisation, synchronisation, Testing Library) ; une boucle de 0 ms en laisserait des milliers.
    expect(vi.getTimerCount()).toBeLessThan(MINUTEURS_AU_REPOS_MAX);
    await act(async () => finir(remise()));
    await screen.findByDisplayValue(MOT_DE_PASSE);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('la boîte ne se ferme ni par Échap ni par un clic à côté (pas de perte par accident), seulement par Fermer ; plus rien ensuite', async () => {
    const { fetchMock, client, user } = monter({ demandes: aValider, ecrire: () => remise() });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    await screen.findByDisplayValue(MOT_DE_PASSE);

    await user.keyboard('{Escape}');
    expect(screen.getByDisplayValue(MOT_DE_PASSE)).toBeInTheDocument();
    fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!);
    expect(screen.getByDisplayValue(MOT_DE_PASSE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Tout le document, attributs compris (pas seulement le texte affiché).
    expect(document.documentElement.outerHTML).not.toContain(MOT_DE_PASSE);
    await avancer(31_000); // l'actualisation n'en rend rien non plus
    expect(document.documentElement.outerHTML).not.toContain(MOT_DE_PASSE);
    nullePart(client, fetchMock, MOT_DE_PASSE);
  });

  it('champ en lecture seule, étiqueté, focalisé et sélectionné à l’ouverture (copie à la main, clavier compris) ; jamais de presse-papiers', async () => {
    const { user } = monter({ demandes: aValider, ecrire: () => remise() });
    const ecrirePressePapiers = vi.spyOn(navigator.clipboard, 'writeText');
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    const boite = await screen.findByRole('dialog', { name: 'Mot de passe temporaire de Éloïse Dupont' });

    const champ = within(boite).getByRole<HTMLInputElement>('textbox', { name: 'Mot de passe temporaire' });
    expect(champ).toHaveValue(MOT_DE_PASSE);
    expect(champ).toHaveAttribute('readonly');
    await waitFor(() => expect(champ).toHaveFocus());
    expect([champ.selectionStart, champ.selectionEnd]).toEqual([0, MOT_DE_PASSE.length]);

    // Tab vers Fermer, puis retour : le texte est de nouveau entièrement sélectionné.
    champ.setSelectionRange(0, 0);
    await user.tab();
    expect(within(boite).getByRole('button', { name: 'Fermer' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(champ).toHaveFocus();
    expect([champ.selectionStart, champ.selectionEnd]).toEqual([0, MOT_DE_PASSE.length]);

    expect(within(boite).queryByRole('button', { name: /Copier/ })).not.toBeInTheDocument();
    expect(ecrirePressePapiers).not.toHaveBeenCalled();
  });

  it.each([
    ['activer', MOT_DE_PASSE],
    ['régénérer', NOUVEAU],
  ] as const)('%s : jamais rien dans la console, rien dans le document une fois la boîte fermée', async (action, mot) => {
    const espions = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { client, fetchMock, user } = monter({
      demandes: action === 'activer' ? aValider : [actif(ELOISE), valide(HUGO, { actions: [] })],
      ecrire: () => remise(mot, action !== 'activer'),
    });
    await screen.findByText('Hugo Lambert');
    await lancer(user, action);
    await screen.findByDisplayValue(mot);
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(espions.flatMap((e) => e.mock.calls.flat().map(String)).some((t) => t.includes(mot))).toBe(false);
    expect(document.documentElement.outerHTML).not.toContain(mot);
    nullePart(client, fetchMock, mot);
  });

  it.each(['activer', 'régénérer'] as const)(
    '%s, échec réseau (le serveur a peut-être déjà posé un mot de passe) : erreur dans la ligne, aucune boîte, jamais rejoué',
    async (action) => {
      const { fetchMock, user } = monter({
        demandes: action === 'activer' ? aValider : [actif(ELOISE), valide(HUGO, { actions: [] })],
        ecrire: () => Promise.reject(new TypeError('Failed to fetch')),
      });
      await screen.findByText('Hugo Lambert');
      await lancer(user, action);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByRole('alert')).toHaveTextContent('Réseau indisponible.');
      await avancer(300_000);
      expect(ecritures(fetchMock)).toHaveLength(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

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

    await choisir(user, ELOISE.nom, `Régénérer le mot de passe de ${ELOISE.nom}`);
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
    expect(within(mdp).getByDisplayValue(NOUVEAU)).toBeInTheDocument();
    await avancer(50);
    nullePart(client, fetchMock, NOUVEAU);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('les trois motifs de l’API, rien d’autre', async () => {
    const { user } = monter({ demandes: lesActifs, ecrire: () => remise(NOUVEAU, true) });
    await screen.findByText('Hugo Lambert');
    await choisir(user, ELOISE.nom, `Régénérer le mot de passe de ${ELOISE.nom}`);
    const boite = await screen.findByRole('dialog');
    expect(within(boite).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['code_perdu', 'code_refuse', 'autre']);
  });

  it('Annuler ne règle rien ; une erreur 409 (onboarding terminé) s’affiche dans la ligne', async () => {
    const { fetchMock, user } = monter({ demandes: lesActifs, ecrire: () => reply(409, { error: 'Action impossible : l’onboarding est terminé', raison: 'onboarding_termine' }) });
    await screen.findByText('Hugo Lambert');
    await choisir(user, ELOISE.nom, `Régénérer le mot de passe de ${ELOISE.nom}`);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ecritures(fetchMock)).toHaveLength(0);

    await choisir(user, ELOISE.nom, `Régénérer le mot de passe de ${ELOISE.nom}`);
    const boite = await screen.findByRole('dialog');
    expect(within(boite).getByRole('radio', { name: 'Mot de passe perdu' })).not.toBeChecked(); // repart vide
    await user.click(within(boite).getByRole('radio', { name: 'Autre raison' }));
    await user.click(within(boite).getByRole('button', { name: 'Régénérer le mot de passe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('onboarding est terminé');
    expect(ecritures(fetchMock)).toEqual([{ url: '/api/demandes/id-eloise/regenerer', corps: { motif: 'autre' } }]);
  });
});

describe('passage à Terminé : l’affaire du serveur, jamais de l’écran', () => {
  it('même quand l’API dit que l’onboarding est complet, l’écran n’appelle jamais POST /terminer ; la ligne passe à Terminée à la lecture suivante', async () => {
    const complet = actif(ELOISE, { onboarding: { motDePasse: true, authenticator: true, termine: true } });
    const { etat, fetchMock } = monter({ demandes: [complet, enAttente(HUGO, { actions: [] })], ecrire: () => reply(200, {}) });
    await screen.findByText('Hugo Lambert');
    await avancer(90_000);
    expect(ecritures(fetchMock)).toEqual([]);

    // Le serveur (tâche toutes les 5 minutes) a terminé le compte : l'écran le montre à l'actualisation.
    etat.demandes = [{ ...complet, statut: 'Terminé', etape: 4, actions: [], onboarding: undefined }, enAttente(HUGO, { actions: [] })];
    await avancer(30_000);
    const ligne = await screen.findByRole('row', { name: /Éloïse Dupont/ });
    await waitFor(() => expect(within(ligne).getByText('Terminée')).toBeInTheDocument());
    expect(ecritures(fetchMock)).toEqual([]);
  });
});
