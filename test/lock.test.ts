import { describe, expect, it } from 'vitest';
import { ServiceError } from '../src/demandes';
import { KeyedLock } from '../src/lock';

describe('KeyedLock', () => {
  it('double clic : la seconde action sur la même clé reçoit 409 action_en_cours, la première aboutit', async () => {
    const lock = new KeyedLock();
    let release!: () => void;
    const first = lock.run('a', () => new Promise<string>((r) => (release = () => r('ok'))));
    const second = lock.run('a', async () => 'jamais');
    await expect(second).rejects.toMatchObject({ status: 409, body: { code: 'action_en_cours' } });
    await expect(second).rejects.toBeInstanceOf(ServiceError);
    release();
    await expect(first).resolves.toBe('ok');
  });

  it('clés différentes en parallèle ; clé libérée après succès comme après échec', async () => {
    const lock = new KeyedLock();
    await expect(Promise.all([lock.run('a', async () => 1), lock.run('b', async () => 2)])).resolves.toEqual([1, 2]);
    await expect(lock.run('a', async () => { throw new Error('panne'); })).rejects.toThrow('panne');
    await expect(lock.run('a', async () => 3)).resolves.toBe(3);
  });
});
