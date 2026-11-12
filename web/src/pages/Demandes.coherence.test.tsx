import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lecturesSuivi, reply } from '@/test/helpers';
import { ELOISE, HUGO, avancer, detailDe, enAttente, monter, tempsSimule, valide } from '@/test/demandes';
import { SUIVI_KEY } from '@/lib/suivi';
import { attendre, ligneCreee } from '@/lib/synchro';

// Audit, lot 3 : la page de détail, la liste et la synchronisation d'Entra disent la même chose, et une erreur ne s'efface pas sans un mot.
tempsSimule();

const CAMILLE_D = { id: 'id-camille', nom: 'Camille Durand' };
const titre = (nom: string) => screen.findByRole('heading', { level: 1, name: nom });
const listeLue = (client: ReturnType<typeof monter>['client']) => waitFor(() => expect(client.getQueryData(SUIVI_KEY)).toBeDefined());

describe('refus d’une demande encore en synchronisation (F-07)', () => {
  it('créée il y a moins de 3 minutes puis refusée depuis sa page : la ligne ne revient pas en fantôme', async () => {
    const { client, user } = monter({
      chemin: `/demandes/${CAMILLE_D.id}`,
      demandes: [enAttente(HUGO)],
      details: { [CAMILLE_D.id]: detailDe(enAttente(CAMILLE_D)) },
      ecrire: () => reply(200, { id: CAMILLE_D.id, statut: 'Refusé' }),
    });
    await listeLue(client);
    // Ce que fait l'écran à la création : la ligne est gardée, l'API ne la rend pas encore.
    act(() => attendre(client, ligneCreee({ id: CAMILLE_D.id, nom: CAMILLE_D.nom, upn: null, poste: null, service: null, dateArrivee: '2026-11-03' })));
    await titre(CAMILLE_D.nom);

    // Ligne en synchronisation (aucune action connue) : la page propose celles du détail, lues sur le serveur.
    await user.click(await screen.findByRole('button', { name: `Refuser la demande de ${CAMILLE_D.nom}` }));
    await user.type(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Doublon');
    await user.click(screen.getByRole('button', { name: 'Confirmer le refus' }));

    expect(await screen.findByText('Hugo Lambert')).toBeInTheDocument();
    await avancer(12_000);
    expect(screen.queryByText(CAMILLE_D.nom)).not.toBeInTheDocument();
  });
});

describe('page de détail : actions et fiche d’après la source la plus avancée (F-12)', () => {
  it('liste en avance (validée, réplication en retard sur le détail) : fiche « en cours », pas « Indisponible » ni « à la validation »', async () => {
    const { client } = monter({ chemin: `/demandes/${ELOISE.id}`, demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => reply(200, {}) });
    await listeLue(client);
    act(() => attendre(client, valide(ELOISE, { actions: [] })));
    await titre(ELOISE.nom);

    const compte = screen.getByRole('region', { name: 'Compte et accès' });
    await waitFor(() => expect(within(compte).getByText('Création en cours')).toBeInTheDocument());
    expect(within(compte).getByText('Ajout en cours')).toBeInTheDocument();
    expect(within(compte).getByText(/attribution en cours/)).toBeInTheDocument();
    expect(within(compte).queryByText(/à la validation|Indisponible/)).not.toBeInTheDocument();
  });

  it('détail en avance sur la liste : ses actions (Activer), pas celles de la liste (Valider)', async () => {
    const { user } = monter({
      chemin: `/demandes/${ELOISE.id}`,
      demandes: [enAttente(ELOISE), enAttente(HUGO)],
      details: { [ELOISE.id]: detailDe(valide(ELOISE, { actions: ['activer'] })) },
      ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration: false, motDePasseTemporaire: 'Kp7m-Xq4r-Tz9w-Hb3n' }),
    });
    await titre(ELOISE.nom);
    expect(screen.queryByRole('button', { name: `Valider la demande de ${ELOISE.nom}` })).not.toBeInTheDocument();
    // La boîte s'ouvre (elle vérifie l'action sur la même ligne que les boutons) et l'action aboutit.
    await user.click(screen.getByRole('button', { name: `Activer le compte de ${ELOISE.nom}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    expect(await screen.findByRole('dialog', { name: `Mot de passe temporaire de ${ELOISE.nom}` })).toBeInTheDocument();
  });
});

describe('demande absente de la liste (liste tronquée, F-13)', () => {
  it('Activer depuis sa page : la boîte s’ouvre, le mot de passe est remis avec le nom', async () => {
    const { user } = monter({
      chemin: `/demandes/${ELOISE.id}`,
      demandes: [enAttente(HUGO)],
      details: { [ELOISE.id]: detailDe(valide(ELOISE, { actions: ['activer'] })) },
      ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration: false, motDePasseTemporaire: 'Kp7m-Xq4r-Tz9w-Hb3n' }),
    });
    await titre(ELOISE.nom);
    await user.click(screen.getByRole('button', { name: `Activer le compte de ${ELOISE.nom}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    const boite = await screen.findByRole('dialog', { name: `Mot de passe temporaire de ${ELOISE.nom}` });
    expect(within(boite).getByDisplayValue('Kp7m-Xq4r-Tz9w-Hb3n')).toBeInTheDocument();
  });

  it('Refuser depuis sa page : la boîte s’ouvre, le refus part, retour à la liste', async () => {
    const ecrits: string[] = [];
    const { user } = monter({
      chemin: `/demandes/${ELOISE.id}`,
      demandes: [enAttente(HUGO)],
      details: { [ELOISE.id]: detailDe(enAttente(ELOISE)) },
      ecrire: (url) => {
        ecrits.push(url);
        return reply(200, { id: ELOISE.id, statut: 'Refusé' });
      },
    });
    await titre(ELOISE.nom);
    await user.click(screen.getByRole('button', { name: `Refuser la demande de ${ELOISE.nom}` }));
    await user.type(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Doublon');
    await user.click(screen.getByRole('button', { name: 'Confirmer le refus' }));
    expect(await screen.findByText('Hugo Lambert')).toBeInTheDocument();
    expect(ecrits).toEqual([`/api/demandes/${ELOISE.id}/refuser`]);
  });

  it('une erreur de l’action reste affichée sur la page (la ligne n’est pas dans la liste)', async () => {
    const { user } = monter({
      chemin: `/demandes/${ELOISE.id}`,
      demandes: [enAttente(HUGO)],
      details: { [ELOISE.id]: detailDe(valide(ELOISE, { actions: ['activer'] })) },
      ecrire: () => reply(500, { error: 'Graph indisponible' }),
    });
    await titre(ELOISE.nom);
    await user.click(screen.getByRole('button', { name: `Activer le compte de ${ELOISE.nom}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    expect(await screen.findByText('Graph indisponible')).toBeInTheDocument();
    await avancer(35_000); // relectures de la liste et du détail
    expect(screen.getByText('Graph indisponible')).toBeInTheDocument();
  });
});

describe('synchronisation vue depuis une page de détail (F-08)', () => {
  it('la liste est relue toutes les 5 s, comme sur la liste', async () => {
    const { client, fetchMock } = monter({ chemin: `/demandes/${ELOISE.id}`, demandes: [enAttente(ELOISE), enAttente(HUGO)], ecrire: () => reply(200, {}) });
    await listeLue(client);
    await titre(ELOISE.nom);
    act(() => attendre(client, valide(ELOISE, { actions: [] })));
    const avant = lecturesSuivi(fetchMock);
    await avancer(16_000);
    expect(lecturesSuivi(fetchMock) - avant).toBeGreaterThanOrEqual(3);
  });
});

describe('erreur d’une ligne qui disparaît (F-48)', () => {
  it('dite dans un message de la page, avec le nom, au lieu de s’effacer', async () => {
    const { etat, user } = monter({ ecrire: () => reply(500, { error: 'Graph indisponible' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(screen.getByRole('button', { name: `Valider la demande de ${ELOISE.nom}` }));
    expect(await screen.findByText('Graph indisponible')).toBeInTheDocument();

    etat.demandes = [enAttente(HUGO)]; // traitée ailleurs
    await avancer(31_000);
    await waitFor(() => expect(screen.queryByRole('row', { name: /Éloïse Dupont/ })).not.toBeInTheDocument());
    const message = screen.getByText(/L’action sur Éloïse Dupont a échoué/);
    expect(message).toBeInTheDocument();
    await user.click(within(message.closest('[data-slot="alert"]') as HTMLElement).getByRole('button', { name: 'Fermer ce message' }));
    expect(screen.queryByText(/L’action sur Éloïse Dupont a échoué/)).not.toBeInTheDocument();
  });
});
