import { ServiceError } from './demandes';

/**
 * Une seule action à la fois par clé (un compte, ou un acteur RH pour la création) : un double clic reçoit 409
 * au lieu de rejouer la même suite d'écritures Graph (deux mots de passe, deux comptes). En mémoire : valable tant que l'app
 * tourne sur une seule instance (B1 du POC) ; au-delà, il faudrait un verrou partagé.
 */
export class KeyedLock {
  private readonly busy = new Set<string>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) {
      throw new ServiceError(409, { error: 'Une action est déjà en cours sur cette demande, patientez', code: 'action_en_cours' });
    }
    this.busy.add(key);
    try {
      return await fn();
    } finally {
      this.busy.delete(key);
    }
  }
}
