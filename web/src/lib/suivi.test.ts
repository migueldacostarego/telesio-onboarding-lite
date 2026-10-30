import { describe, expect, it } from 'vitest';
import { aujourdhui, filtrerDemandes, formatArrivee, ilYA, normaliser, type Demande } from '@/lib/suivi';

const AUJOURDHUI = '2026-10-28';

const d = (nom: string, dateArrivee: string | null, statut: Demande['statut'] = 'EnAttente'): Demande => ({
  id: nom,
  nom,
  upn: null,
  poste: null,
  service: null,
  dateArrivee,
  statut,
  etape: 1,
  actions: [],
});

describe('formatArrivee', () => {
  it('date en français, sans décalage de fuseau', () => {
    expect(formatArrivee('2026-11-03')).toBe('3 nov. 2026');
    expect(formatArrivee('2026-03-01')).toBe('1 mars 2026');
    expect(formatArrivee('2026-12-31')).toBe('31 déc. 2026');
  });

  it('absente ou illisible : « Non renseignée »', () => {
    expect(formatArrivee(null)).toBe('Non renseignée');
    expect(formatArrivee('pas-une-date')).toBe('Non renseignée');
  });
});

describe('ilYA', () => {
  const t0 = 1_000_000_000_000;
  it.each([
    [0, 'à l’instant'],
    [4_999, 'à l’instant'],
    [5_000, 'il y a 5 s'],
    [23_000, 'il y a 20 s'],
    [59_000, 'il y a 55 s'],
    [60_000, 'il y a 1 min'],
    [125_000, 'il y a 2 min'],
    [3_600_000, 'il y a 1 h'],
    [-5_000, 'à l’instant'],
  ])('%i ms : %s', (ecart, attendu) => {
    // Intl met des espaces insécables : on compare avec des espaces ordinaires.
    expect(ilYA(t0, t0 + ecart).replace(/\u00a0/g, ' ')).toBe(attendu);
  });
});

describe('normaliser', () => {
  it('minuscules sans accents', () => {
    expect(normaliser('Éloïse DUPONT-Çà')).toBe('eloise dupont-ca');
  });
});

describe('filtrerDemandes', () => {
  const liste = [d('Éloïse Dupont', '2026-11-03'), d('Anna Martin', '2026-10-20', 'Actif'), d('Zoé Sansdate', null), d('Luc Martin', '2026-11-03', 'Validé')];

  it('recherche par nom sans tenir compte de la casse ni des accents, tous les mots', () => {
    const noms = (terme: string) => filtrerDemandes(liste, { terme, statut: 'tous', tri: 'recentes', aujourdhui: AUJOURDHUI }).map((x) => x.nom);
    expect(noms('eloise')).toEqual(['Éloïse Dupont']);
    expect(noms('ÉLOÏSE')).toEqual(['Éloïse Dupont']);
    expect(noms('dupont eloise')).toEqual(['Éloïse Dupont']);
    expect(noms('martin')).toEqual(['Luc Martin', 'Anna Martin']); // plus récentes d'abord
    expect(noms('anna dupont')).toEqual([]);
    expect(noms('  ')).toHaveLength(4);
    expect(noms('zzz')).toEqual([]);
  });

  it('ne cherche que dans le nom', () => {
    const avecPoste = [{ ...d('Anna Martin', null), poste: 'Comptable', service: 'Finance' }];
    expect(filtrerDemandes(avecPoste, { terme: 'comptable', statut: 'tous', tri: 'recentes', aujourdhui: AUJOURDHUI })).toEqual([]);
  });

  it('filtre par statut, seul ou avec la recherche', () => {
    expect(filtrerDemandes(liste, { terme: '', statut: 'Actif', tri: 'recentes', aujourdhui: AUJOURDHUI }).map((x) => x.nom)).toEqual(['Anna Martin']);
    expect(filtrerDemandes(liste, { terme: 'martin', statut: 'Validé', tri: 'recentes', aujourdhui: AUJOURDHUI }).map((x) => x.nom)).toEqual(['Luc Martin']);
    expect(filtrerDemandes(liste, { terme: '', statut: 'Terminé', tri: 'recentes', aujourdhui: AUJOURDHUI })).toEqual([]);
  });

  describe('tri par date d’arrivée (aujourd’hui : 2026-10-28)', () => {
    const dates = [
      d('Lointaine', '2026-12-01'),
      d('Hier', '2026-10-27'),
      d('Demain', '2026-10-29'),
      d('Sans date', null),
      d('Ancienne', '2026-09-01'),
      d('Aujourdhui', '2026-10-28'),
    ];
    const ordre = (tri: 'avenir' | 'recentes' | 'anciennes') => filtrerDemandes(dates, { terme: '', statut: 'tous', tri, aujourdhui: AUJOURDHUI }).map((x) => x.nom);

    it('par défaut (avenir) : les arrivées à venir de la plus proche à la plus lointaine, puis les passées de la plus récente à la plus ancienne, sans date en dernier', () => {
      expect(ordre('avenir')).toEqual(['Aujourdhui', 'Demain', 'Lointaine', 'Hier', 'Ancienne', 'Sans date']);
    });

    it('une arrivée aujourd’hui compte comme à venir (le jour J)', () => {
      expect(ordre('avenir')[0]).toBe('Aujourdhui');
    });

    it('plus récentes d’abord et plus anciennes d’abord : ordre chronologique, sans date toujours en dernier', () => {
      expect(ordre('recentes')).toEqual(['Lointaine', 'Demain', 'Aujourdhui', 'Hier', 'Ancienne', 'Sans date']);
      expect(ordre('anciennes')).toEqual(['Ancienne', 'Hier', 'Aujourdhui', 'Demain', 'Lointaine', 'Sans date']);
    });

    it('à date égale, par nom ; plusieurs sans date aussi', () => {
      const memes = [d('Zoé', '2026-11-03'), d('Anna', '2026-11-03'), d('Yan', null), d('Bob', null)];
      for (const tri of ['avenir', 'recentes', 'anciennes'] as const) {
        expect(filtrerDemandes(memes, { terme: '', statut: 'tous', tri, aujourdhui: AUJOURDHUI }).map((x) => x.nom)).toEqual(['Anna', 'Zoé', 'Bob', 'Yan']);
      }
    });

    it('le jour qui passe change la partition : la veille à venir devient passée', () => {
      const liste = [d('A', '2026-10-28'), d('B', '2026-10-30')];
      const ordreAu = (jour: string) => filtrerDemandes(liste, { terme: '', statut: 'tous', tri: 'avenir', aujourdhui: jour }).map((x) => x.nom);
      expect(ordreAu('2026-10-28')).toEqual(['A', 'B']);
      expect(ordreAu('2026-10-29')).toEqual(['B', 'A']);
    });
  });

  it('ne modifie pas la liste reçue', () => {
    const copie = [...liste];
    filtrerDemandes(liste, { terme: '', statut: 'tous', tri: 'anciennes', aujourdhui: AUJOURDHUI });
    expect(liste).toEqual(copie);
  });
});

describe('aujourdhui', () => {
  it('AAAA-MM-JJ dans le fuseau du navigateur, avec zéros', () => {
    expect(aujourdhui(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(aujourdhui(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    expect(aujourdhui(new Date(2026, 11, 31, 12, 0))).toBe('2026-12-31');
  });
});
