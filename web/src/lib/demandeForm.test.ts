import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { schemaDemande } from '@/lib/demandeForm';

const GUID = '11111111-2222-4333-8444-555555555555';
const valide = { prenom: ' Camille ', nom: 'Durand', poste: 'Analyste', service: 'Finance', dateArrivee: '2099-11-16', managerId: GUID, licence: 'sku' };

describe('schemaDemande', () => {
  it('zod ne compile pas ses schémas (new Function) : la CSP de /app n’autorise pas eval', () => {
    expect(z.core.globalConfig.jitless).toBe(true);
  });

  it('nettoie les textes (espaces) et accepte une demande complète', () => {
    expect(schemaDemande.parse({ ...valide, prenom: '  Camille   Anne ' })).toMatchObject({ prenom: 'Camille Anne', nom: 'Durand' });
  });

  it.each([
    ['prenom', '   ', 'Prénom requis'],
    ['nom', 'x'.repeat(65), '64 caractères au plus'],
    ['poste', 'x'.repeat(129), '128 caractères au plus'],
    ['service', 'a\u0007b', 'caractères non autorisés'],
    ['dateArrivee', '2026-02-30', 'Date d’arrivée requise'],
    ['dateArrivee', '2000-01-01', 'La date d’arrivée ne peut pas être dans le passé'],
    ['managerId', 'pas-un-guid', 'Choisissez le responsable dans la liste'],
    ['licence', '', 'Choisissez une licence'],
  ])('refuse %s = %j : %s', (champ, valeur, message) => {
    const r = schemaDemande.safeParse({ ...valide, [champ]: valeur });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === champ)?.message).toBe(message);
  });
});
