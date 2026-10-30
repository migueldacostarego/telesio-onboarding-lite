import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lecturesSuivi, reply } from '@/test/helpers';
import { ELOISE, HUGO, actif, avancer, choisir, enAttente, monter, tempsSimule, valide } from '@/test/demandes';
import { SUIVI_KEY, type Suivi } from '@/lib/suivi';
import { DELAI_SYNCHRO_MS } from '@/lib/synchro';

tempsSimule();

const valider = (nom: string) => screen.getByRole('button', { name: `Valider la demande de ${nom}` });
const activer = (nom: string) => screen.getByRole('button', { name: `Activer le compte de ${nom}` });
const ligne = (nom: RegExp) => screen.getByRole('row', { name: nom });
const eloise = () => ligne(/Éloïse Dupont/);
const synchro = () => screen.queryAllByText('synchronisation…');

/** Ce que la réplication d'Entra fait voir : la recherche par statut renvoie encore l'ancien statut (ou rien du tout). */
describe('après Valider : la ligne ne disparaît ni ne revient en arrière tant que l’API est en retard', () => {
  it('l’API renvoie encore EnAttente : la ligne passe tout de suite à Validée (cache compris), avec « synchronisation… »', async () => {
    const { client, fetchMock, user } = monter({ ecrire: () => reply(200, { id: ELOISE.id, statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));

    await waitFor(() => expect(within(eloise()).getByText('Validée')).toBeInTheDocument());
    expect(within(eloise()).getByText('synchronisation…')).toBeInTheDocument();
    const cache = client.getQueryData<Suivi>(SUIVI_KEY)!.demandes.find((d) => d.id === ELOISE.id)!;
    expect(cache).toMatchObject({ statut: 'Validé', etape: 2, actions: [], synchro: true });
    // Les boutons de l'ancien statut ne reviennent pas ; l'autre ligne n'est pas touchée.
    expect(screen.queryByRole('button', { name: /^(Valider|Refuser) la demande de Éloïse Dupont/ })).not.toBeInTheDocument();
    expect(within(ligne(/Hugo Lambert/)).queryByText('synchronisation…')).not.toBeInTheDocument();

    // Plusieurs relectures qui rendent toujours EnAttente : la ligne reste Validée.
    await avancer(12_000);
    expect(lecturesSuivi(fetchMock)).toBeGreaterThanOrEqual(3);
    expect(within(eloise()).getByText('Validée')).toBeInTheDocument();
    expect(within(eloise()).getByText('synchronisation…')).toBeInTheDocument();
  });

  it('l’API ne renvoie pas du tout le compte : la ligne reste affichée', async () => {
    const { etat, user } = monter({ ecrire: () => reply(200, { id: ELOISE.id, statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    etat.demandes = [enAttente(HUGO)]; // la réplication ne l'a pas (plus) dans la recherche par statut Validé ni EnAttente
    await avancer(20_000);
    expect(within(eloise()).getByText('Validée')).toBeInTheDocument();
    expect(within(eloise()).getByText('synchronisation…')).toBeInTheDocument();
  });

  it('l’API rend la ligne au bon statut : l’indicateur disparaît et les données de l’API reprennent la main', async () => {
    const { etat, fetchMock, user } = monter({ ecrire: () => reply(200, { id: ELOISE.id, statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    await waitFor(() => expect(synchro()).toHaveLength(1));

    etat.demandes = [valide(ELOISE, { actions: ['activer'] }), enAttente(HUGO)];
    await avancer(5_500);
    await waitFor(() => expect(synchro()).toHaveLength(0));
    expect(within(eloise()).getByText('Validée')).toBeInTheDocument();
    // Ce sont les actions de l'API qui s'affichent (activer : jour J atteint), pas celles de la projection.
    expect(within(eloise()).getByRole('button', { name: /^Activer le compte de Éloïse/ })).toBeInTheDocument();

    // Plus de relecture toutes les 5 s : seule l'actualisation de 30 s continue.
    const lectures = lecturesSuivi(fetchMock);
    await avancer(10_000);
    expect(lecturesSuivi(fetchMock)).toBe(lectures);
  });

  it('au bout de 3 minutes sans retour de l’API, la ligne n’est plus gardée', async () => {
    const { etat, user } = monter({ ecrire: () => reply(200, { id: ELOISE.id, statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    etat.demandes = [enAttente(HUGO)];

    await avancer(DELAI_SYNCHRO_MS - 10_000);
    expect(within(eloise()).getByText('synchronisation…')).toBeInTheDocument();
    await avancer(15_000);
    await waitFor(() => expect(screen.queryByRole('row', { name: /Éloïse Dupont/ })).not.toBeInTheDocument());
    expect(synchro()).toHaveLength(0);
  });

  it('une ligne qui revient plus avancée que prévu (activée entre-temps) est celle de l’API', async () => {
    const { etat, user } = monter({ ecrire: () => reply(200, { id: ELOISE.id, statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(valider(ELOISE.nom));
    etat.demandes = [actif(ELOISE), enAttente(HUGO)];
    await avancer(5_500);
    await waitFor(() => expect(within(eloise()).getByText('Activée')).toBeInTheDocument());
    expect(synchro()).toHaveLength(0);
  });
});

describe('autres actions', () => {
  it('Refuser : la ligne est retirée comme avant, sans indicateur', async () => {
    const { etat, user } = monter({ ecrire: () => reply(200, { id: ELOISE.id, statut: 'Refusé' }) });
    await screen.findByText('Hugo Lambert');
    await choisir(user, ELOISE.nom, `Refuser la demande de ${ELOISE.nom}`);
    await user.type(await screen.findByRole('textbox', { name: /Motif du refus/ }), 'Raison');
    etat.demandes = [enAttente(HUGO)];
    await user.click(screen.getByRole('button', { name: 'Confirmer le refus' }));
    await waitFor(() => expect(screen.queryByRole('row', { name: /Éloïse Dupont/ })).not.toBeInTheDocument());
    expect(synchro()).toHaveLength(0);
  });

  it('Activer : la ligne passe tout de suite à Activée (mot de passe remis), « synchronisation… » tant que l’API dit Validé', async () => {
    const { client, user } = monter({
      demandes: [valide(ELOISE, { actions: ['activer'] }), enAttente(HUGO, { actions: [] })],
      ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration: false, motDePasseTemporaire: 'Kp7m-Xq4r-Tz9w-Hb3n' }),
    });
    await screen.findByText('Hugo Lambert');
    await user.click(activer(ELOISE.nom));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activer le compte' }));
    await screen.findByText('Kp7m-Xq4r-Tz9w-Hb3n');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(within(eloise()).getByText('Activée')).toBeInTheDocument();
    expect(within(eloise()).getByText('synchronisation…')).toBeInTheDocument();
    expect(client.getQueryData<Suivi>(SUIVI_KEY)!.demandes.find((d) => d.id === ELOISE.id)).toMatchObject({ statut: 'Actif', etape: 3, synchro: true });
    // Le mot de passe n'est pas dans la ligne mise en cache.
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state))).not.toContain('Kp7m');
  });

  it('Régénérer : le statut ne change pas, aucun indicateur', async () => {
    const { user } = monter({
      demandes: [actif(ELOISE), enAttente(HUGO, { actions: [] })],
      ecrire: () => reply(200, { id: ELOISE.id, statut: 'Actif', regeneration: true, motDePasseTemporaire: 'Rw8c-Nd5t-Yf6v-Gj2s' }),
    });
    await screen.findByText('Hugo Lambert');
    await choisir(user, ELOISE.nom, `Régénérer le mot de passe de ${ELOISE.nom}`);
    const boite = await screen.findByRole('dialog');
    await user.click(within(boite).getByRole('radio', { name: 'Mot de passe perdu' }));
    await user.click(within(boite).getByRole('button', { name: /Régénérer/ }));
    await screen.findByText('Rw8c-Nd5t-Yf6v-Gj2s');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(synchro()).toHaveLength(0);
    expect(within(eloise()).getByText('Activée')).toBeInTheDocument();
  });
});
