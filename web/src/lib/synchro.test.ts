import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUIVI_KEY, type Demande, type Suivi } from '@/lib/suivi';
import { DELAI_SYNCHRO_MS, attendre, enSynchro, fusionner } from '@/lib/synchro';

const ligne = (o: Partial<Demande> = {}): Demande => ({
  id: 'a', nom: 'Éloïse Dupont', poste: null, service: null, dateArrivee: null, statut: 'EnAttente', etape: 1, actions: ['approuver', 'refuser'], ...o,
});
const validee = ligne({ statut: 'Validé', etape: 2, actions: [] });

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 28, 12, 0, 0) });
  client = new QueryClient();
});
afterEach(() => vi.useRealTimers());

describe('attendre', () => {
  it('écrit la ligne dans le cache (remplace l’ancienne, ou l’ajoute) avec synchro: true', () => {
    client.setQueryData<Suivi>(SUIVI_KEY, { demandes: [ligne(), ligne({ id: 'b' })], tronque: false });
    attendre(client, validee);
    attendre(client, ligne({ id: 'c' }));
    const { demandes } = client.getQueryData<Suivi>(SUIVI_KEY)!;
    expect(demandes.map((d) => [d.id, d.statut, d.synchro])).toEqual([['a', 'Validé', true], ['b', 'EnAttente', undefined], ['c', 'EnAttente', true]]);
  });

  it('sans liste en cache : rien n’est écrit, la ligne est rendue par fusionner', () => {
    attendre(client, validee);
    expect(client.getQueryData(SUIVI_KEY)).toBeUndefined();
    expect(fusionner(client, [])).toEqual([{ ...validee, synchro: true }]);
  });
});

describe('fusionner', () => {
  it('sans ligne en attente : la liste de l’API, telle quelle', () => {
    const serveur = [ligne()];
    expect(fusionner(client, serveur)).toEqual(serveur);
  });

  it('l’API rend un statut plus ancien : la ligne garde le statut attendu, les autres champs sont ceux de l’API', () => {
    attendre(client, validee);
    const [d] = fusionner(client, [ligne({ poste: 'Comptable' })]);
    expect(d).toMatchObject({ statut: 'Validé', etape: 2, actions: [], poste: 'Comptable', synchro: true });
  });

  it('l’API rend le statut attendu ou plus avancé : l’API reprend la main, l’attente est oubliée', () => {
    attendre(client, validee);
    const apiValide = ligne({ statut: 'Validé', etape: 2, actions: ['activer'] });
    expect(fusionner(client, [apiValide])).toEqual([apiValide]);
    // Oubliée : une lecture suivante en retard (un autre onglet, une requête ancienne) ne ressuscite rien.
    expect(fusionner(client, [ligne()])).toEqual([ligne()]);
  });

  it('l’API ne renvoie pas la ligne : elle est ajoutée ; au bout de 3 minutes elle ne l’est plus', () => {
    attendre(client, validee);
    expect(fusionner(client, []).map((d) => d.id)).toEqual(['a']);
    vi.advanceTimersByTime(DELAI_SYNCHRO_MS - 1);
    expect(fusionner(client, []).map((d) => d.id)).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(fusionner(client, [])).toEqual([]);
  });

  it('à l’échéance, la liste est relue (même sans lecture entre-temps)', () => {
    const relire = vi.spyOn(client, 'invalidateQueries');
    attendre(client, validee);
    vi.advanceTimersByTime(DELAI_SYNCHRO_MS);
    expect(relire).toHaveBeenCalledWith({ queryKey: SUIVI_KEY });
  });

  it('deux clients de requêtes ne partagent rien', () => {
    attendre(client, validee);
    expect(fusionner(new QueryClient(), [])).toEqual([]);
  });
});

describe('enSynchro', () => {
  it('vrai si au moins une ligne porte synchro', () => {
    expect(enSynchro(undefined)).toBe(false);
    expect(enSynchro([ligne()])).toBe(false);
    expect(enSynchro([ligne(), { ...ligne({ id: 'b' }), synchro: true }])).toBe(true);
  });
});
