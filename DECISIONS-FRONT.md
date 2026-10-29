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

## Étape 2 : Activer, mot de passe temporaire, Régénérer, passage à Terminé

- **Le serveur propose maintenant `regenerer`** dans `actions` de `GET /api/suivi` (droit `activer`, compte `Actif`). Sans cela, `actions` valait `[]` pour tous les `Actif` et l'interface n'aurait pas pu offrir Régénérer en suivant la règle « seulement ce que propose `actions` ». Changement dans `src/suivi.ts`, testé (`test/droits.test.ts`), aucune permission Graph de plus, aucun appel de plus. À relire : c'est la seule modification de l'API faite pendant cette session.
- **Le bouton Activer est proposé dès que l'API le propose, même avant la date d'arrivée.** La route refuse avant le jour J (409, message affiché dans la ligne) ; l'interface ne le grise pas d'après l'horloge du navigateur, qui peut différer du fuseau métier (`TZ_METIER`) et bloquer à tort une activation légitime.
- **Le mot de passe temporaire n'existe que dans le DOM de la boîte et dans l'état React de la page.**
  - L'écriture `activer` / `regenerer` est une mutation construite **sans observateur** (`getMutationCache().build(...).execute`) : `useMutation` aurait gardé la dernière réponse dans son résultat. Avec `gcTime: 0`, elle quitte le cache dès qu'elle se termine.
  - Vérifié par des tests (cache des mutations et des requêtes, `localStorage`, `sessionStorage`, adresse, titre, requêtes sortantes, console) et dans Chrome (stockage vide, adresse inchangée, texte absent du HTML après la fermeture).
  - **Copier** écrit dans le presse-papiers du système, sur clic explicite : l'application ne peut pas l'en retirer ensuite. Une copie impossible est annoncée.
- **La boîte du mot de passe ne se ferme ni par Échap ni par un clic à côté** (un mot de passe affiché une seule fois ne doit pas se perdre par accident), seulement par « Fermer ». Elle n'a pas de croix. Une seule boîte à la fois : la confirmation cède la place au mot de passe dans le même rendu.
- **Activer et Régénérer ne sont jamais rejoués** par l'interface (un nouveau mot de passe remplacerait le précédent). Une erreur 409 ou 502 s'affiche dans la ligne, la personne relance.
- **Régénérer** : le motif est un choix parmi les trois codes de l'API (`code_perdu`, `code_refuse`, `autre`), en boutons radio, pas du texte libre (l'API le refuse en 400). Le texte de la confirmation prévient que l'ancien mot de passe ne fonctionne plus.
- **Passage à Terminé.** L'API ne le fait jamais seule : `POST /terminer` n'est appelé que par un écran. « Le passage à Terminé apparaît seul grâce au rafraîchissement » n'était donc vrai qu'à condition que l'écran appelle `terminer`. Il le fait maintenant (`useTerminaisonAuto`) : après chaque lecture de la liste, pour chaque compte `Actif` dont `onboarding.termine` est vrai **et** pour lequel l'API propose `regenerer` (c'est le signe que la personne a le droit `activer`). Le serveur revérifie tout.
  - Silencieux : un 409 `onboarding_non_termine` est normal, aucune erreur n'est affichée.
  - Borné à 5 tentatives par compte et par ouverture de l'écran, pour qu'une panne durable ne déclenche pas une écriture toutes les 30 s.
  - Aucun appel si la lecture Graph du compte a échoué (`verification: echec`) ou si l'onboarding est incomplet.
- **Test serveur instable constaté une fois** : `test/direction.test.ts` « 409 sans suppression… » a échoué une fois pendant que d'autres commandes tournaient en parallèle, puis a passé 4 fois de suite (et sur le code d'avant mes changements). Non lié à cette étape ; à surveiller en CI.
