import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ecritures, lecturesSuivi, reply } from '@/test/helpers';
import { ELOISE, HUGO, avancer, enAttente, monter, tempsSimule, valide } from '@/test/demandes';

tempsSimule();

const sansDossier = (o = {}) => valide(ELOISE, { actions: ['reprendre'], ...o });
const reessayer = (nom = ELOISE.nom) => screen.getByRole('button', { name: `Réessayer la création du dossier de ${nom}` });
const URL_REPRENDRE = '/api/demandes/id-eloise/reprendre';
const voir = (nom: string) => screen.getByRole('link', { name: `Voir le détail de la demande de ${nom}` });
const etape = (p: HTMLElement, cle: string) => p.querySelector(`[data-jalon="${cle}"]`) as HTMLElement;

describe('Réessayer : reprise du dossier SharePoint manquant', () => {
  it('bouton seulement quand l’API propose `reprendre`', async () => {
    monter({ demandes: [sansDossier(), valide(HUGO)], ecrire: () => reply(200, {}) });
    await screen.findByText('Hugo Lambert');
    expect(reessayer()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Réessayer la création du dossier de Hugo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Valider|Refuser|Activer)/ })).not.toBeInTheDocument();
  });

  it('un clic : POST /reprendre {} sans boîte de dialogue, spinner, ligne verrouillée, puis la liste est relue (le bouton disparaît)', async () => {
    let finir!: (r: Response) => void;
    const { etat, fetchMock, user } = monter({ demandes: [sansDossier(), enAttente(HUGO, { actions: [] })], ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    await user.click(reessayer());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(ecritures(fetchMock)).toEqual([{ url: URL_REPRENDRE, corps: {} }]);
    expect(reessayer()).toHaveAttribute('aria-busy', 'true');
    expect(reessayer()).toHaveTextContent(/^Réessayer$/);
    expect(screen.getByRole('status')).toHaveTextContent('Nouvelle tentative…');
    expect(reessayer()).toBeDisabled();
    await user.click(reessayer());
    expect(ecritures(fetchMock)).toHaveLength(1);

    etat.demandes = [valide(ELOISE), enAttente(HUGO, { actions: [] })];
    await act(async () => finir(reply(200, { id: ELOISE.id, statut: 'Validé', dossier: { id: 'd', url: null, cree: true } })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Réessayer la création/ })).not.toBeInTheDocument());
    expect(lecturesSuivi(fetchMock)).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('502 avec étape : erreur dans la ligne, jamais rejoué tout seul, on peut recommencer', async () => {
    const { fetchMock, user } = monter({ demandes: [sansDossier(), enAttente(HUGO, { actions: [] })], ecrire: () => reply(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'dossier_sharepoint', statut: 'Validé' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(reessayer());
    expect(await screen.findByRole('alert')).toHaveTextContent('Étape : dossier_sharepoint');
    expect(reessayer()).toBeEnabled();
    await avancer(300_000);
    expect(ecritures(fetchMock)).toHaveLength(1);
    await user.click(reessayer());
    await waitFor(() => expect(ecritures(fetchMock)).toHaveLength(2));
  });

  it('409 (autre statut, traité ailleurs) : erreur dans la ligne', async () => {
    const { user } = monter({ demandes: [sansDossier(), enAttente(HUGO, { actions: [] })], ecrire: () => reply(409, { error: 'Action impossible dans le statut actuel', statut: 'Actif' }) });
    await screen.findByText('Hugo Lambert');
    await user.click(reessayer());
    expect(await screen.findByRole('alert')).toHaveTextContent('Action impossible dans le statut actuel');
  });

  it('dans le détail aussi : bouton Réessayer, étape Validée en échec « dossier non créé », puis en cours pendant la tentative', async () => {
    let finir!: (r: Response) => void;
    const { fetchMock, user } = monter({ demandes: [sansDossier(), enAttente(HUGO, { actions: [] })], ecrire: () => new Promise<Response>((r) => (finir = r)) });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    const p = await screen.findByRole('heading', { name: ELOISE.nom }).then(() => document.body);
    await screen.findByText('Historique');
    expect(etape(p, 'validee')).toHaveAttribute('data-etat', 'echec');
    expect(etape(p, 'validee')).toHaveTextContent('Le dossier SharePoint n’a pas été créé');

    await user.click(within(p).getByRole('button', { name: 'Réessayer la création du dossier de Éloïse Dupont' }));
    expect(ecritures(fetchMock)).toEqual([{ url: URL_REPRENDRE, corps: {} }]);
    expect(etape(p, 'validee')).toHaveAttribute('data-etat', 'en_cours');
    expect(within(p).getByRole('button', { name: 'Réessayer la création du dossier de Éloïse Dupont' })).toBeDisabled();
    await act(async () => finir(reply(502, { error: 'Le service a échoué ; l’action n’a pas abouti', etape: 'dossier_sharepoint' })));
    expect(await within(p).findByRole('alert')).toHaveTextContent('dossier_sharepoint');
    expect(etape(p, 'validee')).toHaveAttribute('data-etat', 'echec');
    expect(etape(p, 'validee')).toHaveTextContent('La nouvelle tentative a échoué');
  });

  it('un compte Validé qui a son dossier : étape Validée réussie, pas de bouton', async () => {
    const { user } = monter({ demandes: [valide(ELOISE), enAttente(HUGO, { actions: [] })], ecrire: () => reply(200, {}) });
    await screen.findByText('Hugo Lambert');
    await user.click(voir(ELOISE.nom));
    const p = await screen.findByRole('heading', { name: ELOISE.nom }).then(() => document.body);
    await screen.findByText('Historique');
    expect(etape(p, 'validee')).toHaveAttribute('data-etat', 'fait');
    expect(within(p).queryByRole('button', { name: /Réessayer/ })).not.toBeInTheDocument();
  });

  it('session expirée : l’application est prévenue', async () => {
    const { user } = monter({ demandes: [sansDossier(), enAttente(HUGO, { actions: [] })], ecrire: () => reply(401, { error: 'Authentification requise' }), surSession: () => {} });
    await screen.findByText('Hugo Lambert');
    await user.click(reessayer());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
