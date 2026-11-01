import { describe, expect, it } from 'vitest';
import { mapLimit } from '../src/activation';

describe('mapLimit', () => {
  it('ne dépasse jamais la limite de parallélisme et garde l’ordre des éléments', async () => {
    let enCours = 0;
    let max = 0;
    const out = await mapLimit(Array.from({ length: 12 }, (_, i) => i), 5, async (n) => {
      enCours++;
      max = Math.max(max, enCours);
      // Les premiers éléments finissent en dernier : l'ordre du résultat doit rester celui de l'entrée.
      await new Promise((r) => setTimeout(r, (12 - n) * 2));
      enCours--;
      return n * 10;
    });
    expect(max).toBe(5);
    expect(out).toEqual(Array.from({ length: 12 }, (_, i) => i * 10));
  });

  it('liste vide ou plus courte que la limite', async () => {
    expect(await mapLimit([], 5, async (n: number) => n)).toEqual([]);
    expect(await mapLimit([1, 2], 5, async (n) => n + 1)).toEqual([2, 3]);
  });
});
