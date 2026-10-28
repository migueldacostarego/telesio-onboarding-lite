# CLAUDE.md — Telesio Onboarding Lite

## Projet
MVP d'onboarding : RH saisit une demande → la direction valide → compte Entra (désactivé, attributs natifs) + dossier SharePoint → RH active le jour J (TAP remis en main propre). Pas de base de données : l'état vit dans l'extension Entra `statutOnboarding`. Détails : README.md.

## État
- Étapes 1 à 6 fusionnées sur main (licence par groupe : PR #3). En cours sur `feat/tap-autopilot` : étape 7 (activation le jour J, TAP multi-usage 12 h, régénération avec motif, Terminé = mot de passe changé par SSPR + Authenticator) et les corrections de l'audit du parcours (groupe des arrivants posé à la validation, TAP supprimé puis recréé, verrou par compte, statut posé dans `POST /users`).
- À tester à la main : première connexion par TAP avec `forceChangePasswordNextSignIn: true`.
- Envs test et dev déployés (tenant telesiosandbox, abonnement telesio-test). Prod inactive tant qu'il n'y a pas de vrai tenant.
- Stack : Node/TypeScript, App Service, Terraform (infra/), déploiement GitHub Actions en OIDC.

## Règles
- Zéro secret dans le code : identité managée partout (Graph, Key Vault).
- Permissions Graph minimales et justifiées (SharePoint en Sites.Selected).
- Dépendances publiées depuis plus de 7 jours.
- Ne jamais commiter sans mon accord.
- PR avec CI verte avant toute fusion.
- Logs : jamais de nom, UPN ni mot de passe (seulement des objectId).
