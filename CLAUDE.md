# CLAUDE.md — Telesio Onboarding Lite

## Projet
MVP d'onboarding : RH saisit une demande → la direction valide → compte Entra (désactivé, attributs natifs) + dossier SharePoint → RH active le jour J (mot de passe temporaire remis en main propre ; changement imposé par Entra, Authenticator imposé par l'accès conditionnel). Pas de base de données : l'état vit dans l'extension Entra `statutOnboarding`. Détails : README.md.

## État
- Étapes 1 à 7 fusionnées sur main (licence par groupe : PR #3 ; activation par mot de passe temporaire et corrections du parcours : PR #5 ; droit Group.Read.All de l'identité d'apply : PR #4). Le TAP a été abandonné.
- Testé à la main sur test (2026-10-29) : à la 1re connexion, Authenticator puis changement du mot de passe imposés, passage à Terminé ; `User-PasswordProfile.ReadWrite.All` suffit. Réglages du tenant (à refaire à la main par tenant) : docs/reglages-tenant-onboarding.md.
- Envs test et dev déployés (tenant telesiosandbox, abonnement telesio-test). test s'applique à la main (`terraform apply` hors CI) ; dev par la CI à chaque fusion sur main. Dev n'a pas de site SharePoint dédié (validation en 503) : tester le parcours complet sur test. Prod inactive tant qu'il n'y a pas de vrai tenant.
- Stack : Node/TypeScript, App Service, Terraform (infra/), déploiement GitHub Actions en OIDC. Front : `web/` (Vite, React, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query), build dans `dist/web`, servi par Express sous `/app`.
- Front, étape 2 faite : socle posé, un seul écran (« Demandes », en lecture seule d'après `GET /api/suivi` : tableau, recherche, filtre, tri, actualisation 30 s ; pas encore d'actions) avec en-tête, menu utilisateur (`GET /api/moi`) et gestion de session expirée / accès non autorisé. Choix, commandes et limites : README, section « Front React (/app) ».
- Avant la prod : le statut est une extension que tout administrateur d'utilisateurs peut écrire ; restreindre l'app (unité administrative à gestion restreinte) avant le vrai tenant.

## Prochaine étape : migrer les écrans
- Écrans actuels : pages-coquilles servies par `src/routes/pages.ts`, scripts inline (nonce CSP) dans `src/views/layout.ts`, données par `/api` uniquement. Elles restent en place jusqu'à la migration de chaque écran.
- Commencer par l'écran RH. Statut de chaque demande en stepper horizontal (étapes faites en vert, en cours en bleu, à venir en gris, badge « 2 sur 4 »).
- Délais d'Entra à gérer côté écran : un compte tout juste créé n'est pas validable tout de suite (bouton Valider désactivé tant qu'il n'est pas prêt) ; la validation peut prendre ~30 s (attente visible) ; un 202 `licence_en_cours` se revalide seul ; le passage à Terminé peut prendre quelques minutes après la 1re connexion.
- Ne jamais afficher ni stocker le mot de passe temporaire ailleurs que dans le DOM, une seule fois. Côté React : pas de `localStorage`, d'URL ni de cache de requête pour ce mot de passe ; les mutations ont `gcTime: 0` et ne se rejouent jamais (`web/src/lib/query.ts`), garder cela pour `activer` et `regenerer`.
- CSP de `/app` : `script-src 'self'`, `style-src 'self'`, aucun inline ni CDN, polices système, aucun message en console. Pas de `<style>`, de script ni d'attribut `style` écrits en HTML ; `style={{}}` de React est permis (CSSOM). Pas de toast (sonner retiré : il injecte un `<style>`) ni de `next-themes` : messages dans l'écran ou la ligne concernés, avec `alert` (`web/src/components/ApiErrorAlert.tsx`). Contrôler en Chrome headless (`--enable-logging=stderr`) après tout ajout de bibliothèque d'interface.
- Droits : l'interface décide d'après `droits` de `GET /api/moi` (`acces`, `creer`, `approuver`, `activer`, calculés côté serveur d'après `RH_ROLE` et `DIRECTION_ROLE`), jamais d'après le nom d'un rôle ; les noms ne sont écrits nulle part dans `web/`. Les routes de l'API décident d'après les mêmes droits (`droitsDe` : `creer` pour demandes, annuaire et licences ; `acces` pour le suivi ; `activer` pour activer, régénérer, terminer et la liste des activations); `approuver` pour `GET /api/demandes`, `valider` et `refuser`. Il n'y a plus de valideur désigné : tout porteur du rôle Direction peut valider ou refuser, sauf ses propres demandes (l'affectation du rôle, dans `direction_principal_object_ids`, désigne la direction). `GET /api/suivi` renvoie `actions` par demande pour la personne connectée : l'interface ne propose que celles-là. Personne ne valide ni ne refuse sa propre demande (403 `auto_approbation`, créateur lu dans `createurOnboarding`).
- Charte Telesio : seul le logo est au dépôt (`web/src/assets/telesio.svg`, en-tête sur fond sombre car son texte est quasi blanc). Autres jetons : neutres de shadcn (`web/src/index.css`), à remplacer dès réception de la charte.

## Règles
- Zéro secret dans le code : identité managée partout (Graph, Key Vault).
- Permissions Graph minimales et justifiées (SharePoint en Sites.Selected).
- Dépendances publiées depuis plus de 7 jours, en version exacte (pas de `^`). Racine : `npm install --before=<date du jour - 7 j>`. `web/` : `web/.npmrc` impose `save-exact` ; ajouter avec `--before` aussi. Composants shadcn : `cd web && npm_config_before=<date> npm_config_save_exact=true npx shadcn@4.22.1 add <composant>` (le paquet `shadcn` n'est pas une dépendance : avis `npm audit`), puis vérifier `grep '[\^~]' package.json` et `npm audit --prefix web` (0 attendu). `react-hook-form` et zod : avec l'écran Demande.
- Ne jamais commiter sans mon accord.
- PR avec CI verte avant toute fusion.
- Logs : jamais de nom, UPN ni mot de passe (seulement des objectId).
