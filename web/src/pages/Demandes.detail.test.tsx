import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ecritures, reply, stubBureau } from '@/test/helpers';
import { ELOISE, HUGO, actif, avancer, enAttente, monter, tempsSimule, valide } from '@/test/demandes';

tempsSimule();

const ANNA = { id: 'id-anna', nom: 'Anna Martin' };
const SARAH = { id: 'id-sarah', nom: 'Sarah Petit' };
const termine = enAttente(SARAH, { statut: 'Terminé', etape: 4, actions: [] });
const voir = (nom: string) => screen.getByRole('button', { name: `Voir le détail de la demande de ${nom}` });
const panneau = (nom: string) => screen.findByRole('dialog', { name: nom });
const etape = (p: HTMLElement, cle: string) => p.querySelector(`[data-etape="${cle}"]`) as HTMLElement;
const etatsDe = (p: HTMLElement) => ['creee', 'validee', 'activee', 'terminee'].map((c) => `${c}:${etape(p, c).getAttribute('data-etat')}`);
const rien = () => reply(200, {});

describe('panneau de détail', () => {
  it('le nom ouvre le panneau (clic ou clavier) : quatre étapes, chacune avec son état dit en toutes lettres', async () => {
    const { user } = monter({ demandes: [enAttente(ELOISE), valide(HUGO, { actions: ['activer'] }), actif(ANNA), termine], ecrire: rien });
    await screen.findByText('Hugo Lambert');

    await user.click(voir(ELOISE.nom));
    let p = await panneau(ELOISE.nom);
    expect(etatsDe(p)).toEqual(['creee:reussie', 'validee:en_cours', 'activee:a_venir', 'terminee:a_venir']);
    expect(['creee', 'validee', 'activee', 'terminee'].map((c) => etape(p, c).textContent)).toEqual([
      expect.stringContaining('Demande créée : Réussie'),
      expect.stringContaining('Validée : En cours'),
      expect.stringContaining('Activée : À venir'),
      expect.stringContaining('Terminée : À venir'),
    ]);
    expect(etape(p, 'validee')).toHaveAttribute('aria-current', 'step');
    expect(p).toHaveTextContent('En attente de la direction.');
    expect(p).toHaveTextContent('Comptable');
    expect(p).toHaveTextContent('3 nov. 2026');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Au clavier : le nom est un bouton.
    voir(HUGO.nom).focus();
    await user.keyboard('{Enter}');
    p = await panneau(HUGO.nom);
    expect(etatsDe(p)).toEqual(['creee:reussie', 'validee:reussie', 'activee:en_cours', 'terminee:a_venir']);
    expect(p).toHaveTextContent('À activer le jour de l’arrivée (3 nov. 2026).');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(voir(SARAH.nom));
    p = await panneau(SARAH.nom);
    expect(etatsDe(p)).toEqual(['creee:reussie', 'validee:reussie', 'activee:reussie', 'terminee:reussie']);
    expect(p.querySelectorAll('[data-fait]')).toHaveLength(0); // aucun sous-état : l'API n'en fournit pas pour Terminé
  });

  it('la ligne entière est cliquable à la souris, mais pas ses boutons d’action', async () => {
    const { fetchMock, user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => new Promise<Response>(() => {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(within(screen.getByRole('row', { name: /Éloïse Dupont/ })).getByText('Comptable'));
    expect(await panneau(ELOISE.nom)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Valider la demande de Hugo Lambert' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // le clic d'un bouton n'ouvre pas le détail
    expect(ecritures(fetchMock)).toHaveLength(1);
  });

  it('compte Actif : sous-états d’onboarding d’après l’API (Authenticator, mot de passe), mis à jour à l’actualisation sans fermer le panneau', async () => {
    const { etat, user } = monter({ demandes: [actif(ANNA), enAttente(HUGO)], ecrire: rien });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ANNA.nom));
    const p = await panneau(ANNA.nom);
    expect(etatsDe(p)).toEqual(['creee:reussie', 'validee:reussie', 'activee:reussie', 'terminee:en_cours']);
    const sous = () => [...p.querySelectorAll('[data-fait]')].map((li) => `${li.textContent}|${li.getAttribute('data-fait')}`);
    expect(sous()).toEqual(['Authenticator inscrit: à faire|false', 'Mot de passe changé: à faire|false']);

    etat.demandes = [actif(ANNA, { onboarding: { motDePasse: false, authenticator: true, termine: false } }), enAttente(HUGO)];
    await avancer(30_000);
    await waitFor(() => expect(sous()).toEqual(['Authenticator inscrit: fait|true', 'Mot de passe changé: à faire|false']));
    expect(screen.getByRole('dialog', { name: ANNA.nom })).toBeInTheDocument();
  });

  it('lecture de l’onboarding impossible : étape Terminée en échec, aucune case inventée', async () => {
    const { user } = monter({ demandes: [actif(ANNA, { onboarding: { verification: 'echec' } }), enAttente(HUGO)], ecrire: rien });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ANNA.nom));
    const p = await panneau(ANNA.nom);
    expect(etape(p, 'terminee')).toHaveAttribute('data-etat', 'echec');
    expect(p.querySelectorAll('[data-fait]')).toHaveLength(0);
  });

  it('n’affiche que ce que l’API fournit : pas de responsable, pas d’identifiant', async () => {
    const { user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: rien });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    const p = await panneau(ELOISE.nom);
    expect(p.textContent).not.toMatch(/responsable|manager|@|id-eloise/i);
  });

  it('les actions de la ligne y sont aussi : Valider part, spinner dans le panneau, étape Validée en échec sur erreur', async () => {
    let finir!: (r: Response) => void;
    let appels = 0;
    const { fetchMock, user } = monter({
      demandes: [enAttente(ELOISE), enAttente(HUGO)],
      ecrire: () => (++appels === 1 ? new Promise<Response>((r) => (finir = r)) : rien()),
    });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    const p = await panneau(ELOISE.nom);
    expect(within(p).getByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toBeEnabled();
    expect(within(p).getByRole('button', { name: 'Refuser la demande de Éloïse Dupont' })).toBeEnabled();
    expect(within(p).queryByRole('button', { name: /Activer|Régénérer/ })).not.toBeInTheDocument();

    await user.click(within(p).getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    expect(ecritures(fetchMock)).toEqual([{ url: '/api/demandes/id-eloise/valider', corps: {} }]);
    expect(within(p).getByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toHaveAttribute('aria-busy', 'true');
    expect(within(p).getByRole('button', { name: 'Refuser la demande de Éloïse Dupont' })).toBeDisabled();

    await act(async () => finir(reply(409, { error: 'Aucune licence disponible', code: 'licence_indisponible' })));
    expect(await within(p).findByRole('alert')).toHaveTextContent('Aucune licence disponible');
    expect(etape(p, 'validee')).toHaveAttribute('data-etat', 'echec');
    await user.click(within(p).getByRole('button', { name: 'Fermer ce message' }));
    expect(within(p).queryByRole('alert')).not.toBeInTheDocument();
    expect(etape(p, 'validee')).toHaveAttribute('data-etat', 'en_cours');
  });

  it('attente automatique dite dans l’étape : « Compte en cours de création »', async () => {
    const { user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => reply(404, { error: 'Demande introuvable' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    const p = await panneau(ELOISE.nom);
    await user.click(within(p).getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    expect(await within(p).findByText('Compte en cours de création : nouvel essai automatique.')).toBeInTheDocument();
    expect(within(p).getByText('Compte en cours de création')).toBeInTheDocument(); // et sous les boutons
    expect(within(p).getByRole('button', { name: 'Valider la demande de Éloïse Dupont' })).toBeDisabled();
  });

  it('pendant une action sur la ligne : ni la ligne ni le nom n’ouvrent le détail', async () => {
    const { user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => new Promise<Response>(() => {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(screen.getByRole('button', { name: 'Valider la demande de Éloïse Dupont' }));
    expect(voir(ELOISE.nom)).toBeDisabled();
    await user.click(within(screen.getByRole('row', { name: /Éloïse Dupont/ })).getByText('Comptable'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(voir(HUGO.nom)).toBeEnabled(); // les autres lignes ne sont pas touchées
  });

  it('se ferme quand la demande disparaît de la liste (refusée ailleurs)', async () => {
    const { etat, user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: rien });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    await panneau(ELOISE.nom);
    etat.demandes = [enAttente(HUGO)];
    await avancer(30_000);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Refuser depuis le panneau : la boîte de confirmation s’ouvre par-dessus, puis tout se ferme quand la demande disparaît', async () => {
    const { etat, fetchMock, user } = monter({
      demandes: [enAttente(ELOISE), enAttente(HUGO)],
      ecrire: () => {
        etat.demandes = [enAttente(HUGO)];
        return rien();
      },
    });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    const p = await panneau(ELOISE.nom);
    await user.click(within(p).getByRole('button', { name: 'Refuser la demande de Éloïse Dupont' }));
    const boite = await screen.findByRole('dialog', { name: 'Refuser la demande de Éloïse Dupont ?' });
    await user.type(within(boite).getByRole('textbox'), 'Poste supprimé');
    await user.click(within(boite).getByRole('button', { name: 'Confirmer le refus' }));
    await waitFor(() => expect(ecritures(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Activer depuis le panneau : le mot de passe s’affiche une seule fois, par-dessus', async () => {
    const { user } = monter({
      demandes: [valide(ELOISE, { actions: ['activer'] }), enAttente(HUGO)],
      ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration: false, motDePasseTemporaire: 'Kp7m-Xq4r-Tz9w-Hb3n' }),
    });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    const p = await panneau(ELOISE.nom);
    await user.click(within(p).getByRole('button', { name: 'Activer le compte de Éloïse Dupont' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Activer le compte de Éloïse Dupont ?' })).getByRole('button', { name: 'Activer le compte' }));
    expect(await screen.findByText('Kp7m-Xq4r-Tz9w-Hb3n')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(document.body.textContent).not.toContain('Kp7m-Xq4r-Tz9w-Hb3n'));
  });
});

describe('mobile : la carte ouvre le détail', () => {
  it('clic sur la carte ou sur le nom ; pas sur ses boutons', async () => {
    stubBureau(false);
    const { user } = monter({ demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => new Promise<Response>(() => {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(within(document.getElementById('demande-id-eloise') as HTMLElement).getByText('Arrivée : 3 nov. 2026'));
    expect(await panneau(ELOISE.nom)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Valider la demande de Hugo Lambert' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
