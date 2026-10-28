# État Terraform de l'environnement dev (compte créé par scripts/bootstrap-state.sh, partagé avec test :
# même abonnement, donc même compte et même conteneur ; seule la clé change).
# Auth Entra (pas de clé d'accès) : use_azuread_auth ici, OIDC via ARM_USE_OIDC en CI, az login en local.
resource_group_name  = "rg-telesio-tfstate"
storage_account_name = "sttelesiotfstatefa7542"
container_name       = "tfstate"
key                  = "telesio-onboarding-lite.dev.tfstate"
use_azuread_auth     = true
