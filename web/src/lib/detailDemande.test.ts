import { describe, expect, it } from 'vitest';
import { intitulePoste, ligneDuDetail, reconcilier } from '@/lib/detailDemande';
import { ELOISE, actif, detailDe, enAttente, valide } from '@/test/demandes';

describe('reconcilier', () => {
  it('sans ligne de la liste : le détail seul', () => {
    const d = detailDe(valide(ELOISE), { actions: ['activer'] });
    expect(reconcilier(d, undefined)).toEqual({ etape: 2, statut: 'Validé', onboarding: undefined, actions: ['activer'] });
  });

  it('ligne plus avancée que le détail (réplication d’Entra) : l’étape et le statut de la ligne font foi', () => {
    const d = detailDe(enAttente(ELOISE));
    const ligne = valide(ELOISE, { actions: ['activer'] });
    expect(reconcilier(d, ligne)).toMatchObject({ etape: 2, statut: 'Validé', actions: ['activer'] });
  });

  it('ligne en retard sur le détail : le détail fait foi, la ligne ne fait pas reculer', () => {
    const d = detailDe(valide(ELOISE));
    const ligne = enAttente(ELOISE);
    expect(reconcilier(d, ligne)).toMatchObject({ etape: 2, statut: 'Validé' });
  });

  it('même étape : statut du détail', () => {
    const d = detailDe(valide(ELOISE), { statut: 'Validé' });
    const ligne = valide(ELOISE, { statut: 'Actif' });
    expect(reconcilier(d, ligne)).toMatchObject({ etape: 2, statut: 'Validé' });
  });

  it('même étape : les actions de la ligne l’emportent sur celles du détail', () => {
    const d = detailDe(enAttente(ELOISE), { actions: ['approuver'] });
    expect(reconcilier(d, enAttente(ELOISE, { actions: [] })).actions).toEqual([]);
  });

  it('même étape, ligne en synchronisation (actions inconnues du client) : celles du détail', () => {
    const d = detailDe(enAttente(ELOISE), { actions: ['approuver', 'refuser'] });
    expect(reconcilier(d, enAttente(ELOISE, { actions: [], synchro: true })).actions).toEqual(['approuver', 'refuser']);
  });

  it('détail plus avancé que la ligne : ses actions', () => {
    const d = detailDe(valide(ELOISE), { actions: ['activer'] });
    expect(reconcilier(d, enAttente(ELOISE)).actions).toEqual(['activer']);
  });

  describe('onboarding', () => {
    const lu = (o: Partial<{ motDePasse: boolean; authenticator: boolean; termine: boolean }>) => ({ motDePasse: false, authenticator: false, termine: false, ...o });

    it('ligne en synchronisation : son onboarding, même si le détail en porte un', () => {
      const d = detailDe(actif(ELOISE), { onboarding: lu({ motDePasse: true }) });
      const ligne = actif(ELOISE, { synchro: true, onboarding: lu({ authenticator: true }) });
      expect(reconcilier(d, ligne).onboarding).toEqual(lu({ authenticator: true }));
    });

    it('ligne en synchronisation sans onboarding : aucun (pas celui du détail)', () => {
      const d = detailDe(actif(ELOISE), { onboarding: lu({ motDePasse: true }) });
      const ligne = actif(ELOISE, { synchro: true, onboarding: undefined });
      expect(reconcilier(d, ligne).onboarding).toBeUndefined();
    });

    it('ligne synchronisée : celui du détail l’emporte', () => {
      const d = detailDe(actif(ELOISE), { onboarding: lu({ motDePasse: true }) });
      const ligne = actif(ELOISE, { onboarding: lu({ authenticator: true }) });
      expect(reconcilier(d, ligne).onboarding).toEqual(lu({ motDePasse: true }));
    });

    it('détail sans onboarding : celui de la ligne', () => {
      const d = detailDe(actif(ELOISE, { onboarding: undefined }));
      const ligne = actif(ELOISE, { onboarding: lu({ authenticator: true }) });
      expect(reconcilier(d, ligne).onboarding).toEqual(lu({ authenticator: true }));
    });

    it('ni l’un ni l’autre : indéfini', () => {
      expect(reconcilier(detailDe(valide(ELOISE)), valide(ELOISE)).onboarding).toBeUndefined();
    });
  });
});

describe('ligneDuDetail', () => {
  it('la ligne de la liste, telle quelle, quand elle fait foi', () => {
    const ligne = valide(ELOISE, { actions: [], synchro: true });
    expect(ligneDuDetail(detailDe(enAttente(ELOISE)), ligne)).toBe(ligne);
  });

  it('sinon une ligne d’après le détail (statut, étape, actions, onboarding), sans marque de synchronisation', () => {
    const d = detailDe(actif(ELOISE), { actions: ['regenerer'] });
    const attendue = { id: ELOISE.id, nom: ELOISE.nom, statut: 'Actif', etape: 3, actions: ['regenerer'], onboarding: d.onboarding };
    expect(ligneDuDetail(d, undefined)).toMatchObject(attendue);
    expect(ligneDuDetail(d, valide(ELOISE, { synchro: true }))).not.toHaveProperty('synchro');
  });
});

describe('intitulePoste', () => {
  it('poste et service, séparés par un point médian', () => {
    expect(intitulePoste({ poste: 'Comptable', service: 'Finance' })).toBe('Comptable · Finance');
  });

  it('l’un ou l’autre seul', () => {
    expect(intitulePoste({ poste: 'Comptable', service: null })).toBe('Comptable');
    expect(intitulePoste({ poste: null, service: 'Finance' })).toBe('Finance');
  });

  it('rien (null ou chaîne vide) : « Poste non renseigné »', () => {
    expect(intitulePoste({ poste: null, service: null })).toBe('Poste non renseigné');
    expect(intitulePoste({ poste: '', service: '' })).toBe('Poste non renseigné');
  });
});
