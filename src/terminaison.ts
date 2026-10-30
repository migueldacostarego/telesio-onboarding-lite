import { activationConfig, inspectActifs, terminerOnboarding, type ActivationDeps } from './activation';
import { ServiceError } from './demandes';
import { graphFailureProps } from './directory';
import type { KeyedLock } from './lock';

/** « Acteur » des événements de la tâche : pas une personne, aucun objectId d'utilisateur. */
export const ACTEUR_TERMINAISON = 'systeme:terminaison';

/** Comptes Actif examinés par passage au plus (au-delà, le passage suivant reprend : 10 pages de 100 côté Graph). */
const MAX_COMPTES = 1000;

export interface BilanTerminaison {
  /** Comptes Actif examinés. */
  lus: number;
  /** Comptes passés à Terminé pendant ce passage. */
  termines: number;
  /** Comptes dont la finalisation a échoué (le passage suivant réessaie) ou qu'une autre action occupait. */
  ignores: number;
}

/**
 * Passe à Terminé les comptes Actif dont l'onboarding est complet (mot de passe changé après la remise ET Authenticator
 * inscrit). Le serveur ne s'en remet à personne : `terminerOnboarding` revérifie chaque compte avant d'écrire (retrait du groupe
 * des arrivants, puis statut en dernier), comme la route `POST /terminer` qu'il réutilise. Un compte qu'une action de la
 * personne RH occupe (verrou en mémoire) est laissé au passage suivant. Chaque passage à Terminé est tracé
 * (`onboarding.termine_auto`, objectId du compte seulement). Ne lève jamais d'erreur de compte : un échec n'arrête pas les autres.
 */
export async function terminerComptesAcheves(deps: ActivationDeps, lock: KeyedLock): Promise<BilanTerminaison> {
  const { config, directory, audit } = deps;
  activationConfig(deps); // ARRIVANTS_GROUP_ID et ENTRA_ACTIVATION_EXTENSION : sinon 503, la tâche ne démarre pas
  const { demandes } = await directory.listByStatut(config.statusExtension, 'Actif');
  const inspectes = await inspectActifs(deps, ACTEUR_TERMINAISON, demandes.slice(0, MAX_COMPTES));
  const bilan: BilanTerminaison = { lus: inspectes.length, termines: 0, ignores: 0 };
  for (const d of inspectes) {
    // { verification: 'echec' } (lecture Graph impossible) ou onboarding incomplet : rien à faire pour ce compte.
    if (!('termine' in d.onboarding) || !d.onboarding.termine) continue;
    try {
      const r = await lock.run(d.id.toLowerCase(), () => terminerOnboarding(deps, ACTEUR_TERMINAISON, d.id));
      if (!r.deja) {
        bilan.termines++;
        audit.track({ action: 'onboarding.termine_auto', actor: ACTEUR_TERMINAISON, outcome: 'ok', cible: d.id });
      }
    } catch {
      bilan.ignores++; // déjà tracé par terminerOnboarding (demande.echec, demande.conflit) ; 409 action_en_cours : pas d'événement
    }
  }
  return bilan;
}

export interface OptionsTerminaison {
  /** Période entre deux passages, en ms. */
  intervalleMs: number;
  /** Premier passage après ce délai (défaut : 30 s, pour ne pas attendre une période entière après un redémarrage). */
  premierDelaiMs?: number;
}

/**
 * Tâche récurrente dans l'application : un passage toutes les `intervalleMs` (5 minutes par défaut), le suivant n'est planifié
 * qu'une fois le précédent terminé (jamais deux passages en même temps dans une instance).
 *
 * **Pas de verrou partagé entre instances** : valable pour le POC à une seule instance App Service (comme `KeyedLock`). Avec
 * plusieurs instances, chacune exécuterait la tâche ; sans conséquence grave (`terminerOnboarding` est rejouable, un compte déjà
 * Terminé est ignoré) mais les passages seraient doublés et un événement de plus tracé. Au-delà d'une instance : verrou partagé
 * (bail de blob, par exemple) ou tâche planifiée à part.
 *
 * Renvoie la fonction d'arrêt. Le minuteur est `unref` : il ne retient pas le processus à l'arrêt.
 */
export function demarrerTerminaisonAuto(deps: ActivationDeps, lock: KeyedLock, { intervalleMs, premierDelaiMs = 30_000 }: OptionsTerminaison): () => void {
  let arrete = false;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const planifier = (ms: number) => {
    if (arrete) return;
    minuteur = setTimeout(() => void passage(), ms);
    minuteur.unref();
  };
  const passage = async () => {
    try {
      const bilan = await terminerComptesAcheves(deps, lock);
      if (bilan.termines > 0 || bilan.ignores > 0) {
        deps.audit.track({ action: 'terminaison.passage', actor: ACTEUR_TERMINAISON, outcome: 'ok', ...bilan });
      }
    } catch (err) {
      // Liste Graph impossible, ou configuration absente : tracé sans message brut, le prochain passage réessaie.
      const code = err instanceof ServiceError ? { http: err.status } : graphFailureProps(err);
      deps.audit.track({ action: 'terminaison.passage', actor: ACTEUR_TERMINAISON, outcome: 'erreur', ...code });
    } finally {
      planifier(intervalleMs);
    }
  };
  planifier(premierDelaiMs);
  return () => {
    arrete = true;
    clearTimeout(minuteur);
  };
}
