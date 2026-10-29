# Décisions du front (session autonome du 2026-10-30)

Choix faits sans attendre de réponse quand une étape en demandait un qui change le comportement. Règle suivie : l'option la plus sûre, notée ici. À relire et à corriger si besoin.

## Avant les étapes

- **Découpage des deux premiers commits.** Le tri par date d'arrivée n'a pas pu être séparé de l'écran Demandes : il est dans `filtrerDemandes`, dans la barre et dans l'en-tête du tableau, qui sont des fichiers neufs. Le commit 1 (`b471f1b`) contient l'écran **avec** le tri ; le commit 2 (`a706d5b`) contient la CSP à nonce seule (route Express, meta, `get-nonce`, menu modal). Réécrire l'historique pour les séparer aurait demandé un rebase interactif, non disponible ici.

## Étape 1 : Approuver / Refuser

- **Pas de champ « compte prêt » dans `GET /api/suivi`.** Le bouton Valider ne peut donc pas être désactivé d'avance (CLAUDE.md le souhaitait). Le seul signal est le **404 `Demande introuvable`** de `POST /valider`, renvoyé par `loadForAction` avant toute écriture. Je l'ai traité comme « compte en cours de création » : message dans la ligne, ligne verrouillée, **nouvel essai automatique** à 5, 5, 10, 10, 15 et 15 s (6 essais, environ une minute). Passé ce plafond, l'erreur s'affiche avec `ApiErrorAlert` et les boutons sont rendus : un compte réellement supprimé donne aussi 404, il ne faut pas boucler.
  - Exception assumée à « une écriture n'est jamais rejouée » : elle est sûre (rien n'a été écrit), bornée, et annulée si la demande disparaît de la liste ou n'offre plus `approuver`.
  - `refuser` n'est **jamais** rejoué sur un 404 (c'est une suppression) : l'erreur s'affiche.
  - Alternative écartée : ajouter côté API un champ de disponibilité (une lecture Graph de plus par demande, hors périmètre).
- **202 `licence_en_cours`** : « Licence en cours d'attribution », revalidation automatique après 60 s, **5 fois au plus**, puis un avertissement (pas une erreur) et la main rendue. Même annulation que ci-dessus.
- **État de chaque ligne au niveau de la page** (`useActionsDemandes`), par id : la recherche, le filtre ou le passage tableau / cartes démontent les lignes sans perdre le spinner, ni un nouvel essai planifié, ni une erreur, et sans permettre un second clic. Le serveur garde en plus son verrou (409 `action_en_cours`).
- **Une session expirée** (401 ou réponse hors JSON) sur une écriture passe par la `MutationCache` de `query.ts` : écran de reconnexion, aucune erreur de ligne.
- **Erreurs** (403 `auto_approbation`, 409, 502 avec `etape`) : `ApiErrorAlert` sous la ligne (tableau) ou dans la carte (mobile), avec « Fermer ce message ». Elles restent jusqu'à fermeture ou nouvelle tentative, même si la liste change entre-temps. La liste est relue après chaque erreur (la demande a pu être traitée ailleurs, ou une reprise partielle avoir eu lieu).
- **Refuser** : boîte de dialogue, motif obligatoire (espaces seuls refusés, 500 caractères au plus, limite de l'API), bouton « Confirmer le refus ». Pendant l'attente la boîte ne se ferme ni par Échap, ni par Annuler. À la réponse elle se ferme, et une éventuelle erreur est dans la ligne (le motif saisi est perdu : il n'est conservé nulle part). La boîte se ferme aussi si la demande ne se refuse plus (traitée ailleurs).
- **Lacune de l'API, non contournée** : après un 502 `dossier` (SharePoint), le compte est `Validé`. L'API accepte de rappeler `valider` pour reprendre le dossier, mais `actions` n'offre plus `approuver` à la direction : l'interface ne propose donc aucune reprise. À décider : exposer une action `reprendre` dans `actions`, ou laisser RH réessayer via l'écran actuel `/direction`.
- **Journal du navigateur** : Chrome écrit « Failed to load resource » pour chaque réponse HTTP non 2xx (404, 409, 502 des scénarios de contrôle). Ce n'est pas un message de la console de l'application (0 `console.error`, 0 exception, 0 violation CSP) et aucun code ne peut le supprimer.
