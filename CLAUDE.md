# CLAUDE.md — Telesio Onboarding Lite

## Projet
MVP d'onboarding : RH saisit une demande → la direction valide → compte Entra (désactivé, attributs natifs) + dossier SharePoint → RH active le jour J (TAP remis en main propre). Pas de base de données : l'état vit dans l'extension Entra `statutOnboarding`. Détails : README.md.

## État
- MVP fusionné sur main. En cours : licence par groupe Entra + usageLocation FR. La validation direction est bloquée s'il n'y a plus de licence libre ; l'ajout au groupe se fait à la validation (pour réserver le siège).
- Envs test et dev déployés (tenant telesiosandbox, abonnement telesio-test). Prod inactive tant qu'il n'y a pas de vrai tenant.
- Stack : Node/TypeScript, App Service, Terraform (infra/), déploiement GitHub Actions en OIDC.

## Règles
- Zéro secret dans le code : identité managée partout (Graph, Key Vault).
- Permissions Graph minimales et justifiées (SharePoint en Sites.Selected).
- Dépendances publiées depuis plus de 7 jours.
- Ne jamais commiter sans mon accord.
- PR avec CI verte avant toute fusion.
- Logs : jamais de nom, UPN ni mot de passe (seulement des objectId).
