import { describe, expect, it } from 'vitest';
import { sousTitre } from '@/lib/etat';

const base = { dateArrivee: '2026-11-03', actions: [] as string[], onboarding: undefined };
const JOUR = '2026-10-30';

describe('ligne d’état sous le statut', () => {
  it('une phrase par situation, d’après `actions` et `onboarding` de l’API', () => {
    expect(sousTitre({ ...base, statut: 'EnAttente' }, JOUR).texte).toBe('En attente de la direction');
    expect(sousTitre({ ...base, statut: 'Validé', actions: ['activer'] }, JOUR).texte).toBe('À activer maintenant');
    expect(sousTitre({ ...base, statut: 'Validé' }, JOUR).texte).toBe('Activation le 3 nov.');
    expect(sousTitre({ ...base, statut: 'Validé', dateArrivee: null }, JOUR).texte).toBe('Prête pour l’arrivée');
    expect(sousTitre({ ...base, statut: 'Terminé' }, JOUR).texte).toBe('Onboarding terminé');
  });

  it('dossier SharePoint à refaire : en alerte, et prioritaire sur « à activer »', () => {
    expect(sousTitre({ ...base, statut: 'Validé', actions: ['activer', 'reprendre'] }, JOUR)).toEqual({ texte: 'Dossier SharePoint à refaire', alerte: true });
  });

  it('compte Activé : où en sont Authenticator et le mot de passe', () => {
    const actif = (onboarding: object | undefined) => sousTitre({ ...base, statut: 'Actif', onboarding: onboarding as never }, JOUR);
    expect(actif({ motDePasse: false, authenticator: false, termine: false }).texte).toBe('En attente de la 1re connexion');
    expect(actif({ motDePasse: false, authenticator: true, termine: false }).texte).toBe('Mot de passe à changer');
    expect(actif({ motDePasse: true, authenticator: false, termine: false }).texte).toBe('Authenticator à inscrire');
    expect(actif({ motDePasse: true, authenticator: true, termine: true }).texte).toBe('Tout est fait, clôture en cours');
    expect(actif({ verification: 'echec' })).toEqual({ texte: 'État de l’onboarding illisible', alerte: true });
    expect(actif(undefined).texte).toBe('En attente de la 1re connexion');
  });
});
