import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { schemaDemande } from '@/lib/demandeForm';

const GUID = '11111111-2222-4333-8444-555555555555';
const DOMAINE = 'exemple.test';
const schema = schemaDemande(DOMAINE);
const valide = { prenom: ' Camille ', nom: 'Durand', email: ' Camille.Durand@Exemple.Test ', typeContrat: 'Employé', poste: 'Analyste', service: 'Finance', dateArrivee: '2099-11-16', managerId: GUID };

describe('schemaDemande', () => {
  it('zod ne compile pas ses schémas (new Function) : la CSP de /app n’autorise pas eval', () => {
    expect(z.core.globalConfig.jitless).toBe(true);
  });

  it('nettoie les textes (espaces) et accepte une demande complète', () => {
    expect(schema.parse({ ...valide, prenom: '  Camille   Anne ' })).toMatchObject({ prenom: 'Camille Anne', nom: 'Durand' });
  });

  it('met l’adresse en minuscules et retire les espaces ; aucune licence dans la sortie', () => {
    const sortie = schema.parse(valide);
    expect(sortie.email).toBe('camille.durand@exemple.test');
    expect(Object.keys(sortie).sort()).toEqual(['dateArrivee', 'email', 'managerId', 'nom', 'poste', 'prenom', 'service', 'typeContrat']);
  });

  it.each([
    ['prenom', '   ', 'Prénom requis'],
    ['nom', 'x'.repeat(65), '64 caractères au plus'],
    ['poste', 'x'.repeat(129), '128 caractères au plus'],
    ['service', 'a\u0007b', 'caractères non autorisés'],
    ['dateArrivee', '2026-02-30', 'Date d’arrivée requise'],
    ['dateArrivee', '2000-01-01', 'La date d’arrivée ne peut pas être dans le passé'],
    ['managerId', 'pas-un-guid', 'Choisissez le responsable dans la liste'],
    ['email', '', 'Adresse e-mail requise'],
    ['email', 'camille', 'Adresse en @exemple.test requise'],
    ['email', 'a@b@exemple.test', 'Adresse en @exemple.test requise'],
    ['email', 'camille@autre.test', 'Le domaine doit être exemple.test'],
    ['email', 'camillé@exemple.test', 'Avant @ : lettres sans accent, chiffres, points et tirets (64 caractères au plus)'],
    ['email', 'camille..durand@exemple.test', 'Avant @ : lettres sans accent, chiffres, points et tirets (64 caractères au plus)'],
    ['email', `${'a'.repeat(65)}@exemple.test`, 'Avant @ : lettres sans accent, chiffres, points et tirets (64 caractères au plus)'],
    ['typeContrat', '', 'Choisissez un type de contrat'],
    ['typeContrat', 'Stagiaire', 'Choisissez un type de contrat'],
  ])('refuse %s = %j : %s', (champ, valeur, message) => {
    const r = schema.safeParse({ ...valide, [champ]: valeur });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === champ)?.message).toBe(message);
  });
});
