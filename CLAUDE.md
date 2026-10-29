# CLAUDE.md — Telesio Onboarding Lite

## Projet
MVP d'onboarding : RH saisit une demande → la direction valide → compte Entra (désactivé, attributs natifs) + dossier SharePoint → RH active le jour J (mot de passe temporaire remis en main propre ; changement imposé par Entra, Authenticator imposé par l'accès conditionnel). Pas de base de données : l'état vit dans l'extension Entra `statutOnboarding`. Détails : README.md.

## État
- Étapes 1 à 6 fusionnées sur main (licence par groupe : PR #3). En cours sur `feat/tap-autopilot` : étape 7 (activation le jour J, mot de passe temporaire à changer à la 1re connexion, régénération avec motif, Terminé = mot de passe changé + Authenticator inscrit ; le TAP a été abandonné) et les corrections de l'audit du parcours (groupe des arrivants posé à la validation, verrou par compte, statut posé dans `POST /users`).
- À tester à la main : première connexion avec le mot de passe temporaire (changement imposé, puis inscription d'Authenticator par l'accès conditionnel, voir docs/reglages-tenant-onboarding.md) ; savoir si `User-PasswordProfile.ReadWrite.All` suffit ou s'il faut le rôle Password Administrator.
- Envs test et dev déployés (tenant telesiosandbox, abonnement telesio-test). Prod inactive tant qu'il n'y a pas de vrai tenant.
- Stack : Node/TypeScript, App Service, Terraform (infra/), déploiement GitHub Actions en OIDC.

## Règles
- Zéro secret dans le code : identité managée partout (Graph, Key Vault).
- Permissions Graph minimales et justifiées (SharePoint en Sites.Selected).
- Dépendances publiées depuis plus de 7 jours.
- Ne jamais commiter sans mon accord.
- PR avec CI verte avant toute fusion.
- Logs : jamais de nom, UPN ni mot de passe (seulement des objectId).
