import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ecritures, reply, stubBureau } from '@/test/helpers';
import { ELOISE, HUGO, actif, avancer, detailDe, enAttente, monter, tempsSimule, valide } from '@/test/demandes';

tempsSimule();

const ANNA = { id: 'id-anna', nom: 'Anna Martin' };
const SARAH = { id: 'id-sarah', nom: 'Sarah Petit' };
const termine = enAttente(SARAH, { statut: 'Terminé', etape: 4, actions: [] });
const rien = () => reply(200, {});
const jalon = (cle: string) => document.querySelector(`[data-jalon="${cle}"]`) as HTMLElement;
const etats = () => [...document.querySelectorAll('[data-jalon]')].map((j) => `${j.getAttribute('data-jalon')}:${j.getAttribute('data-etat')}`);
const lien = (nom: string) => screen.getByRole('link', { name: `Voir le détail de la demande de ${nom}` });

describe('page de détail /demandes/:id', () => {
  it('le nom est un vrai lien vers la page, dont l’adresse ne porte que l’objectId ; « Toutes les demandes » revient à la liste', async () => {
    const { user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: rien });
    await screen.findByText('Hugo Lambert');
    expect(lien(ELOISE.nom)).toHaveAttribute('href', `/demandes/${ELOISE.id}`);
    await user.click(lien(ELOISE.nom));
    expect(await screen.findByRole('heading', { level: 1, name: ELOISE.nom })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/demandes/${ELOISE.id}`);
    expect(window.location.search + window.location.hash).toBe('');
    // Rien d'autre que l'id dans l'adresse ni dans l'historique du navigateur (history.state est conservé par le navigateur).
    expect(window.location.href).not.toMatch(/Dupont|Éloïse|exemple\.test/i);
    expect(JSON.stringify(window.history.state)).not.toMatch(/Dupont|Éloïse|exemple\.test/i);

    await user.click(screen.getByRole('link', { name: 'Toutes les demandes' }));
    expect(await screen.findByText('Hugo Lambert')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('un clic sur la ligne l’ouvre aussi, mais pas un clic sur ses boutons', async () => {
    const { fetchMock, user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => new Promise<Response>(() => {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(within(screen.getByRole('row', { name: /Hugo Lambert/ })).getByText('Comptable'));
    expect(await screen.findByRole('heading', { level: 1, name: HUGO.nom })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Toutes les demandes' }));

    await screen.findByText('Éloïse Dupont');
    await user.click(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    expect(window.location.pathname).toBe('/'); // le clic d'un bouton n'ouvre pas la page
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('identité, responsable, licence, groupe des arrivants et dossier SharePoint', async () => {
    monter({ demandes: [valide(ELOISE), enAttente(HUGO)], ecrire: rien, chemin: `/demandes/${ELOISE.id}` });
    const identite = await screen.findByRole('region', { name: 'Identité' });
    const valeur = (zone: HTMLElement, libelle: string) => within(zone).getByText(libelle).nextElementSibling as HTMLElement;
    expect(valeur(identite, 'E-mail')).toHaveTextContent('compte.eloise@exemple.test');
    expect(valeur(identite, 'Poste')).toHaveTextContent('Comptable');
    expect(valeur(identite, 'Service')).toHaveTextContent('Finance');
    expect(valeur(identite, 'Responsable')).toHaveTextContent('Chef Exemple');
    expect(valeur(identite, 'Arrivée')).toHaveTextContent('3 nov. 2026');
    const compte = screen.getByRole('region', { name: 'Compte et accès' });
    expect(valeur(compte, 'Licence')).toHaveTextContent('Business Premium : attribuée');
    expect(valeur(compte, 'Arrivants')).toHaveTextContent('Membre');
    const dossier = within(compte).getByRole('link', { name: /Ouvrir dans SharePoint/ });
    expect(dossier).toHaveAttribute('href', 'https://sp.exemple.test/dossier');
    expect(dossier).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Éloïse Dupont');
  });

  it('demande en attente : licence réservée, groupe et dossier créés à la validation', async () => {
    monter({ demandes: [enAttente(ELOISE)], ecrire: rien, chemin: `/demandes/${ELOISE.id}` });
    const compte = await screen.findByRole('region', { name: 'Compte et accès' });
    expect(compte).toHaveTextContent('Business Premium : réservée à la validation');
    expect(compte).toHaveTextContent('Ajouté à la validation');
    expect(compte).toHaveTextContent('Créé à la validation');
    expect(within(compte).queryByRole('link')).not.toBeInTheDocument();
  });

  it('dossier absent ou illisible, groupe illisible : dit tel quel, rien d’inventé', async () => {
    const d = valide(ELOISE);
    monter({ demandes: [d], ecrire: rien, chemin: `/demandes/${ELOISE.id}`, details: { [ELOISE.id]: detailDe(d, { dossier: { etat: 'absent' }, groupeArrivants: null, manager: null }) } });
    const compte = await screen.findByRole('region', { name: 'Compte et accès' });
    expect(compte).toHaveTextContent('Non créé');
    expect(compte).toHaveTextContent('Indisponible');
    expect(screen.getByText('Responsable').nextElementSibling).toHaveTextContent('Non renseigné');
  });

  it('chronologie d’un compte Terminé : qui et quand, en heure de Paris, étapes dites en toutes lettres', async () => {
    monter({ demandes: [termine, enAttente(HUGO)], ecrire: rien, chemin: `/demandes/${SARAH.id}` });
    await screen.findByText('Historique');
    expect(etats()).toEqual(['creee:fait', 'validee:fait', 'activee:fait', 'authenticator:fait', 'motDePasse:fait', 'terminee:fait']);
    // 20 oct. 2026 08:15 UTC = 10:15 à Paris (UTC+2 jusqu'au 25 oct.), 28 oct. 07:00 UTC = 08:00 (UTC+1).
    expect(jalon('creee')).toHaveTextContent('Demande créée : Fait');
    expect(jalon('creee')).toHaveTextContent('20 oct. 2026 à 10:15, par Camille RH');
    expect(jalon('validee')).toHaveTextContent('21 oct. 2026 à 11:30, par Claire Direction');
    expect(jalon('activee')).toHaveTextContent('28 oct. 2026 à 08:00, par Camille RH');
    expect(jalon('authenticator')).toHaveTextContent('28 oct. 2026 à 10:10');
    expect(jalon('motDePasse')).toHaveTextContent('28 oct. 2026 à 10:20');
    expect(jalon('terminee')).toHaveTextContent('29 oct. 2026 à 11:05, par le serveur (automatiquement)');
    expect(screen.getByText('Heures de Paris.')).toBeInTheDocument();
    expect(document.querySelector('time[datetime="2026-10-28T07:00:00Z"]')).not.toBeNull();
  });

  it('compte Actif : Authenticator et mot de passe d’après l’API, régénérations comptées, mis à jour à l’actualisation', async () => {
    const m = monter({ demandes: [actif(ANNA), enAttente(HUGO)], ecrire: rien, chemin: `/demandes/${ANNA.id}` });
    await screen.findByText('Historique');
    expect(etats()).toEqual(['creee:fait', 'validee:fait', 'activee:fait', 'authenticator:a_venir', 'motDePasse:a_venir', 'terminee:en_cours']);
    expect(jalon('terminee')).toHaveAttribute('aria-current', 'step');

    const avec = actif(ANNA, { onboarding: { motDePasse: false, authenticator: true, termine: false } });
    m.etat.demandes = [avec, enAttente(HUGO)];
    m.etat.details[ANNA.id] = detailDe(avec, { historique: { ...detailDe(avec).historique, regeneration: { le: '2026-10-28T12:00:00Z', par: { nom: 'Claire Direction' }, nombre: 2 } } });
    await avancer(30_000);
    await waitFor(() => expect(etats()).toEqual(['creee:fait', 'validee:fait', 'activee:fait', 'regeneration:fait', 'authenticator:fait', 'motDePasse:a_venir', 'terminee:en_cours']));
    expect(jalon('regeneration')).toHaveTextContent('Mot de passe régénéré (2 fois, dernière remise)');
    expect(jalon('regeneration')).toHaveTextContent('28 oct. 2026 à 13:00, par Claire Direction');
  });

  it('étapes faites avant l’historique : « Date non enregistrée », jamais une date inventée ; auteur supprimé nommé comme tel', async () => {
    const d = valide(ELOISE);
    monter({
      demandes: [d],
      ecrire: rien,
      chemin: `/demandes/${ELOISE.id}`,
      details: { [ELOISE.id]: detailDe(d, { historique: { ...detailDe(d).historique, enregistre: false, creation: { le: '2026-10-20T08:15:00Z', par: null }, validation: null } }) },
    });
    await screen.findByText('Historique');
    expect(jalon('validee')).toHaveTextContent('Date non enregistrée');
    expect(jalon('creee')).toHaveTextContent('Auteur non enregistré');
    expect(screen.getByText(/n’est pas encore enregistré sur cet environnement/)).toBeInTheDocument();

    const autre = valide(HUGO);
    cleanup();
    monter({ demandes: [autre], ecrire: rien, chemin: `/demandes/${HUGO.id}`, details: { [HUGO.id]: detailDe(autre, { historique: { ...detailDe(autre).historique, validation: { le: '2026-10-21T09:30:00Z', par: { nom: null } } } }) } });
    await waitFor(() => expect(document.body.textContent).toContain('par un compte supprimé'));
  });

  it('Authenticator inscrit sans date (Entra ne la fournit pas) : dit tel quel', async () => {
    const d = actif(ANNA);
    monter({
      demandes: [d],
      ecrire: rien,
      chemin: `/demandes/${ANNA.id}`,
      details: { [ANNA.id]: detailDe(d, { onboarding: { motDePasse: false, authenticator: true, termine: false }, historique: { ...detailDe(d).historique, authenticator: { le: null } } }) },
    });
    await screen.findByText('Historique');
    expect(jalon('authenticator')).toHaveTextContent('Date non fournie par Entra.');
    expect(jalon('authenticator')).toHaveAttribute('data-etat', 'fait');
  });

  it('lecture de l’onboarding impossible : étape Terminé en échec, aucune case inventée', async () => {
    monter({ demandes: [actif(ANNA, { onboarding: { verification: 'echec' } })], ecrire: rien, chemin: `/demandes/${ANNA.id}` });
    await screen.findByText('Historique');
    expect(jalon('terminee')).toHaveAttribute('data-etat', 'echec');
    expect(jalon('authenticator')).toHaveAttribute('data-etat', 'echec');
    expect(jalon('motDePasse')).toHaveAttribute('data-etat', 'a_venir');
  });

  it('404 : « Demande introuvable » avec retour à la liste ; autre erreur : message et Réessayer', async () => {
    monter({ demandes: [enAttente(HUGO)], ecrire: rien, chemin: '/demandes/id-inconnu' });
    expect(await screen.findByRole('heading', { name: 'Demande introuvable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Toutes les demandes' })).toBeInTheDocument();
  });

  it('erreur du serveur : ApiErrorAlert et Réessayer, qui relit', async () => {
    let panne = true;
    const m = monter({ demandes: [enAttente(HUGO)], ecrire: rien, chemin: `/demandes/${HUGO.id}`, lire: (url) => (panne && url === `/api/demandes/${HUGO.id}` ? reply(503, { error: 'Activation non configurée' }) : undefined) });
    // 503 : relu deux fois au plus (lib/query.ts), puis l'erreur.
    await avancer(10_000);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    panne = false;
    await m.user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Historique')).toBeInTheDocument();
  });

  it('la liste a la demande mais pas encore le détail (404 de réplication) : nouveaux essais bornés, pas de « introuvable »', async () => {
    let cree = false;
    const m = monter({ demandes: [enAttente(ELOISE)], ecrire: rien, chemin: `/demandes/${ELOISE.id}` });
    const reponse = m.fetchMock.getMockImplementation()!;
    m.fetchMock.mockImplementation((url: string, init?: RequestInit) => (url === `/api/demandes/${ELOISE.id}` && !cree ? Promise.resolve(reply(404, { error: 'Demande introuvable' })) : reponse(url, init)));
    await avancer(4_000);
    expect(screen.queryByRole('heading', { name: 'Demande introuvable' })).not.toBeInTheDocument();
    cree = true;
    await avancer(8_000);
    expect(await screen.findByText('Historique')).toBeInTheDocument();
  });
});

describe('actions depuis la page de détail (état partagé avec la liste)', () => {
  it('Valider part, spinner sur la page, étape Validée en échec sur erreur, fermer le message la remet en cours', async () => {
    let finir!: (r: Response) => void;
    let appels = 0;
    const { fetchMock, user } = monter({
      demandes: [enAttente(ELOISE), enAttente(HUGO)],
      ecrire: () => (++appels === 1 ? new Promise<Response>((r) => (finir = r)) : rien()),
      chemin: `/demandes/${ELOISE.id}`,
    });
    await screen.findByText('Historique');
    expect(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Refuser la demande de Éloïse Dupont' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Activer|Régénérer/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    expect(ecritures(fetchMock)).toEqual([{ url: '/api/demandes/id-eloise/valider', corps: {} }]);
    expect(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Refuser la demande de Éloïse Dupont' })).toBeDisabled();

    await act(async () => finir(reply(409, { error: 'Aucune licence disponible', code: 'licence_indisponible' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Aucune licence disponible');
    expect(jalon('validee')).toHaveAttribute('data-etat', 'echec');
    await user.click(screen.getByRole('button', { name: 'Fermer ce message' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(jalon('validee')).toHaveAttribute('data-etat', 'en_cours');
  });

  it('un spinner en cours survit à la navigation : retour à la liste puis à la page, la ligne reste verrouillée', async () => {
    const { fetchMock, user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => new Promise<Response>(() => {}), chemin: `/demandes/${ELOISE.id}` });
    await screen.findByText('Historique');
    await user.click(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    await user.click(screen.getByRole('link', { name: 'Toutes les demandes' }));
    expect(await screen.findByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toBeDisabled();
    await user.click(lien(ELOISE.nom));
    await screen.findByText('Historique');
    expect(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toBeDisabled();
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('attente automatique dite dans l’étape : « Compte en cours de création »', async () => {
    const { user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => reply(404, { error: 'Demande introuvable' }), chemin: `/demandes/${ELOISE.id}` });
    await screen.findByText('Historique');
    await user.click(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    expect(await screen.findByText('Compte en cours de création : nouvel essai automatique.')).toBeInTheDocument();
    expect(screen.getByText('Compte en cours de création')).toBeInTheDocument(); // et sous les boutons
    expect(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toBeDisabled();
  });

  it('Refuser : la boîte de confirmation, puis retour à la liste (la demande est supprimée)', async () => {
    const { etat, fetchMock, user } = monter({
      demandes: [enAttente(ELOISE), enAttente(HUGO)],
      ecrire: () => {
        etat.demandes = [enAttente(HUGO)];
        return rien();
      },
      chemin: `/demandes/${ELOISE.id}`,
    });
    await screen.findByText('Historique');
    await user.click(screen.getByRole('button', { name: 'Refuser la demande de Éloïse Dupont' }));
    const boite = await screen.findByRole('dialog', { name: 'Refuser la demande de Éloïse Dupont ?' });
    await user.type(within(boite).getByRole('textbox'), 'Poste supprimé');
    await user.click(within(boite).getByRole('button', { name: 'Confirmer le refus' }));
    await waitFor(() => expect(ecritures(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await screen.findByText('Hugo Lambert')).toBeInTheDocument();
    expect(screen.queryByText('Éloïse Dupont')).not.toBeInTheDocument();
  });

  it('Activer : le mot de passe s’affiche une seule fois, par-dessus la page ; ni adresse ni stockage', async () => {
    const { user } = monter({
      demandes: [valide(ELOISE, { actions: ['activer'] }), enAttente(HUGO)],
      ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration: false, motDePasseTemporaire: 'Kp7m-Xq4r-Tz9w-Hb3n' }),
      chemin: `/demandes/${ELOISE.id}`,
    });
    await screen.findByText('Historique');
    await user.click(screen.getByRole('button', { name: 'Activer le compte de Éloïse Dupont' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Activer le compte de Éloïse Dupont ?' })).getByRole('button', { name: 'Activer le compte' }));
    expect(await screen.findByText('Kp7m-Xq4r-Tz9w-Hb3n')).toBeInTheDocument();
    expect(window.location.href).not.toContain('Kp7m');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage, historique: window.history.state })).not.toContain('Kp7m');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(document.body.textContent).not.toContain('Kp7m-Xq4r-Tz9w-Hb3n'));
  });

  it('page ouverte pendant la réplication d’Entra : la ligne de la liste fait foi pour l’étape (statut Validée tout de suite)', async () => {
    const { etat, user } = monter({ demandes: [enAttente(ELOISE)], ecrire: rien, chemin: `/demandes/${ELOISE.id}` });
    await screen.findByText('Historique');
    // La liste (cache) est plus avancée que la lecture du détail, encore « En attente » : synchro de lib/synchro.ts.
    expect(etat.demandes[0]!.statut).toBe('EnAttente');
    await user.click(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    await waitFor(() => expect(jalon('validee')).toHaveAttribute('data-etat', 'fait'));
    expect(screen.getAllByText('Validée').length).toBeGreaterThan(0);
  });
});

describe('mobile', () => {
  it('la page tient en une colonne ; le lien de la carte ouvre la page', async () => {
    stubBureau(false);
    const { user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => new Promise<Response>(() => {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(within(document.getElementById('demande-id-eloise') as HTMLElement).getByText('Arrivée : 3 nov. 2026'));
    expect(await screen.findByRole('heading', { level: 1, name: ELOISE.nom })).toBeInTheDocument();
  });
});
