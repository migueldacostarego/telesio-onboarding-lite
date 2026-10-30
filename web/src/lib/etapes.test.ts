import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import type { EtatLigne } from '@/lib/actions';
import { etapesDe } from '@/lib/etapes';

const etats = (d: Parameters<typeof etapesDe>[0], e?: EtatLigne) => etapesDe(d, e).map((x) => `${x.cle}:${x.etat}`);
const base = { dateArrivee: '2026-11-03' };
const erreur = (action: 'valider' | 'activer' | 'refuser' | 'regenerer' | 'reprendre'): EtatLigne => ({ phase: 'erreur', action, error: new ApiError({ status: 409, kind: 'conflit', message: 'x' }) });

describe('étapes d’une demande', () => {
  it.each([
    [1, ['creee:reussie', 'validee:en_cours', 'activee:a_venir', 'terminee:a_venir']],
    [2, ['creee:reussie', 'validee:reussie', 'activee:en_cours', 'terminee:a_venir']],
    [3, ['creee:reussie', 'validee:reussie', 'activee:reussie', 'terminee:en_cours']],
    [4, ['creee:reussie', 'validee:reussie', 'activee:reussie', 'terminee:reussie']],
  ])('étape %i de l’API', (etape, attendu) => {
    expect(etats({ ...base, etape, onboarding: etape === 3 ? { motDePasse: false, authenticator: false, termine: false } : undefined })).toEqual(attendu);
  });

  it('libellés : Demande créée, Validée, Activée, Terminée', () => {
    expect(etapesDe({ ...base, etape: 1 }).map((e) => e.libelle)).toEqual(['Demande créée', 'Validée', 'Activée', 'Terminée']);
  });

  it('compte Actif : sous-états d’onboarding d’après l’API (Authenticator, mot de passe)', () => {
    const sous = (o: { motDePasse: boolean; authenticator: boolean; termine: boolean }) => etapesDe({ ...base, etape: 3, onboarding: o })[3]?.sousEtats;
    expect(sous({ motDePasse: false, authenticator: false, termine: false })).toEqual([
      { libelle: 'Authenticator inscrit', fait: false },
      { libelle: 'Mot de passe changé', fait: false },
    ]);
    expect(sous({ motDePasse: true, authenticator: false, termine: false })?.map((s) => s.fait)).toEqual([false, true]);
    expect(sous({ motDePasse: true, authenticator: true, termine: true })?.map((s) => s.fait)).toEqual([true, true]);
    expect(etapesDe({ ...base, etape: 3, onboarding: { motDePasse: true, authenticator: true, termine: true } })[3]?.detail).toContain('automatique');
  });

  it('pas de sous-états hors Actif (l’API n’en fournit pas pour Terminé)', () => {
    for (const etape of [1, 2, 4]) expect(etapesDe({ ...base, etape })[3]?.sousEtats).toBeUndefined();
  });

  it('lecture de l’onboarding en échec : l’étape Terminée est en échec, sans sous-états inventés', () => {
    const e = etapesDe({ ...base, etape: 3, onboarding: { verification: 'echec' } })[3];
    expect(e?.etat).toBe('echec');
    expect(e?.sousEtats).toBeUndefined();
  });

  it('échec de valider ou d’activer : l’étape correspondante est en échec ; refuser et régénérer n’y changent rien', () => {
    expect(etats({ ...base, etape: 1 }, erreur('valider'))).toEqual(['creee:reussie', 'validee:echec', 'activee:a_venir', 'terminee:a_venir']);
    expect(etats({ ...base, etape: 2 }, erreur('activer'))).toEqual(['creee:reussie', 'validee:reussie', 'activee:echec', 'terminee:a_venir']);
    expect(etats({ ...base, etape: 1 }, erreur('refuser'))).toEqual(['creee:reussie', 'validee:en_cours', 'activee:a_venir', 'terminee:a_venir']);
    expect(etats({ ...base, etape: 3, onboarding: { motDePasse: false, authenticator: false, termine: false } }, erreur('regenerer'))[3]).toBe('terminee:en_cours');
  });

  it('attentes automatiques de la validation : dites dans l’étape Validée, qui reste en cours', () => {
    expect(etapesDe({ ...base, etape: 1 }, { phase: 'compte_en_creation' })[1]).toMatchObject({ etat: 'en_cours', detail: expect.stringContaining('Compte en cours de création') });
    expect(etapesDe({ ...base, etape: 1 }, { phase: 'licence_en_cours' })[1]?.detail).toContain('Licence en cours d’attribution');
  });

  it('date d’arrivée dite dans l’étape Activée', () => {
    expect(etapesDe({ ...base, etape: 2 })[2]?.detail).toContain('3 nov. 2026');
    expect(etapesDe({ dateArrivee: null, etape: 2 })[2]?.detail).toContain('non renseignée');
  });

  it('compte Validé sans dossier SharePoint (API : reprendre) : étape Validée en échec, en cours pendant la reprise, de nouveau en échec si elle échoue', () => {
    const d = { ...base, etape: 2, actions: ['reprendre'] };
    expect(etapesDe(d)[1]).toMatchObject({ etat: 'echec', detail: expect.stringContaining('dossier SharePoint') });
    expect(etapesDe(d, { phase: 'en_cours', action: 'reprendre' })[1]).toMatchObject({ etat: 'en_cours' });
    expect(etapesDe(d, erreur('reprendre'))[1]).toMatchObject({ etat: 'echec', detail: expect.stringContaining('nouvelle tentative') });
    expect(etapesDe({ ...base, etape: 2, actions: [] })[1]?.etat).toBe('reussie');
    expect(etapesDe({ ...base, etape: 3, actions: ['reprendre'] })[1]?.etat).toBe('reussie'); // seulement pour un compte Validé
  });
});
