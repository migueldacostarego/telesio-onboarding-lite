import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { BrowserRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import type { DemandeDetail } from '@/lib/detail';
import { createQueryClient } from '@/lib/query';
import type { Demande } from '@/lib/suivi';
import { Demandes } from '@/pages/Demandes';
import { DetailDemande } from '@/pages/DetailDemande';
import { FournisseurDemandes } from '@/pages/FournisseurDemandes';
import { mockApi, reply } from '@/test/helpers';

// Requêtes fictives encore en attente à la fin d'un test : libérées, sinon TanStack (mutation sans observateur, gcTime 0) réarme un
// minuteur de 0 ms en boucle et le suivant, aux minuteries simulées, ne rend plus la main.
const aLiberer: Array<() => void> = [];

/** À appeler en tête d'un fichier de test : temps simulé (le temps réel continue de couler), date figée au 28 octobre 2026. */
export function tempsSimule() {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 28, 12, 0, 0) });
  });
  afterEach(async () => {
    aLiberer.splice(0).forEach((liberer) => liberer());
    await Promise.resolve();
    vi.useRealTimers();
  });
}

export const ELOISE = { id: 'id-eloise', nom: 'Éloïse Dupont' };
export const HUGO = { id: 'id-hugo', nom: 'Hugo Lambert' };
export const enAttente = (p: { id: string; nom: string }, o: Partial<Demande> = {}): Demande => ({
  ...p,
  upn: `compte.${p.id.replace('id-', '')}@exemple.test`,
  poste: 'Comptable',
  service: 'Finance',
  dateArrivee: '2026-11-03',
  statut: 'EnAttente',
  etape: 1,
  actions: ['approuver', 'refuser'],
  ...o,
});
export const valide = (p: { id: string; nom: string }, o: Partial<Demande> = {}): Demande => enAttente(p, { statut: 'Validé', etape: 2, actions: [], ...o });
export const actif = (p: { id: string; nom: string }, o: Partial<Demande> = {}): Demande =>
  enAttente(p, { statut: 'Actif', etape: 3, actions: ['regenerer'], onboarding: { motDePasse: false, authenticator: false, termine: false }, ...o });

/**
 * Détail (GET /api/demandes/:id) d'une demande de la liste : un historique plausible selon l'étape (validée le 21 oct., activée le
 * 28 oct., terminée le 29 oct. 2026, heures UTC), des valeurs de `surcharge` par-dessus.
 */
export const detailDe = (d: Demande, surcharge: Partial<DemandeDetail> = {}): DemandeDetail => ({
  id: d.id,
  nom: d.nom,
  upn: d.upn,
  poste: d.poste,
  service: d.service,
  manager: { nom: 'Chef Exemple' },
  dateArrivee: d.dateArrivee,
  statut: d.statut,
  etape: d.etape as DemandeDetail['etape'],
  licence: { libelle: 'Business Premium', etat: d.etape >= 2 ? 'attribuee' : 'choisie' },
  groupeArrivants: d.etape >= 2 ? { membre: d.etape < 4 } : null,
  dossier: d.etape >= 2 ? { etat: 'present', url: 'https://sp.exemple.test/dossier' } : null,
  ...(d.onboarding ? { onboarding: d.onboarding } : {}),
  actions: d.actions,
  historique: {
    enregistre: true,
    creation: { le: '2026-10-20T08:15:00Z', par: { nom: 'Camille RH' } },
    validation: d.etape >= 2 ? { le: '2026-10-21T09:30:00Z', par: { nom: 'Claire Direction' } } : null,
    activation: d.etape >= 3 ? { le: '2026-10-28T07:00:00Z', par: { nom: 'Camille RH' } } : null,
    regeneration: null,
    authenticator: d.etape >= 4 || (d.onboarding && 'authenticator' in d.onboarding && d.onboarding.authenticator) ? { le: '2026-10-28T09:10:00Z' } : null,
    motDePasse: d.etape >= 4 || (d.onboarding && 'motDePasse' in d.onboarding && d.onboarding.motDePasse) ? { le: '2026-10-28T09:20:00Z' } : null,
    termine: d.etape >= 4 ? { le: '2026-10-29T10:05:00Z', par: { nom: null, systeme: true } } : null,
  },
  ...surcharge,
});

/** Fausse API avec une liste que les tests modifient : `suivi` relit toujours `etat.demandes`. */
export function monter(o: {
  /** Adresse de départ (la liste par défaut) : `/demandes/<id>` ouvre une page de détail. */
  chemin?: string;
  /** Détails servis par GET /api/demandes/:id (par id), à défaut déduits de la liste. */
  details?: Record<string, DemandeDetail>; demandes?: Demande[]; moi?: object; lire?: (url: string) => Response | Promise<Response> | undefined; disponibilite?: (email: string) => Response | Promise<Response>; ecrire: (url: string, corps: Record<string, unknown>) => Response | Promise<Response>; surSession?: () => void }) {
  const etat = { demandes: o.demandes ?? [enAttente(ELOISE), enAttente(HUGO)], details: { ...o.details } as Record<string, DemandeDetail> };
  // GET /api/demandes/:id : le détail posé dans `etat.details`, à défaut celui qui se déduit de la ligne de la liste, à défaut 404.
  const lire = (url: string) => {
    const surcharge = o.lire?.(url); // une réponse imposée par le test l'emporte
    if (surcharge) return surcharge;
    const m = /^\/api\/demandes\/([^/]+)$/.exec(url);
    if (m) {
      const id = decodeURIComponent(m[1] as string);
      const ligne = etat.demandes.find((d) => d.id === id);
      const detail = etat.details[id] ?? (ligne ? detailDe(ligne) : undefined);
      return detail ? reply(200, detail) : reply(404, { error: 'Demande introuvable' });
    }
    return undefined;
  };
  const ecrire = (url: string, corps: Record<string, unknown>) => {
    const r = o.ecrire(url, corps);
    if (!(r instanceof Promise)) return r;
    return new Promise<Response>((resolve, reject) => {
      aLiberer.push(() => resolve(reply(200, {})));
      r.then(resolve, reject);
    });
  };
  const fetchMock = mockApi({ moi: o.moi, disponibilite: o.disponibilite, suivi: () => reply(200, { demandes: etat.demandes, tronque: false }), lire, ecrire });
  const client = createQueryClient(o.surSession);
  // BrowserRouter lit l'adresse de jsdom, partagée entre les tests : on la remet à chaque montage.
  window.history.replaceState(null, '', o.chemin ?? '/');
  const vue = render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <FournisseurDemandes>
          <Routes>
            <Route index element={<Demandes />} />
            <Route path="demandes/:id" element={<DetailDemande />} />
          </Routes>
        </FournisseurDemandes>
      </BrowserRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  return { etat, fetchMock, client, user, ...vue };
}

export const avancer = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** Le bouton « … » d'une ligne (les actions secondaires et le détail) : désactivé tant que quelque chose tourne pour la ligne. */
export const menu = (nom: string) => screen.getByRole('button', { name: `Autres actions pour ${nom}` });

/** Ouvre le menu « … » de la ligne de `nom` et choisit l'entrée dont le nom accessible est `libelle` (ex. « Refuser la demande de … »). */
export async function choisir(user: UserEvent, nom: string, libelle: string) {
  await user.click(menu(nom));
  await user.click(await screen.findByRole('menuitem', { name: libelle }));
}
