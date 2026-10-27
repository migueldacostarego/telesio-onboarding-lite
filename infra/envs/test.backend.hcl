# État Terraform de l'environnement test (créé par scripts/bootstrap-state.sh).
# Auth Entra (pas de clé d'accès) : use_azuread_auth, az login en local.
resource_group_name  = "rg-telesio-tfstate"
storage_account_name = "sttelesiotfstatefa7542"
container_name       = "tfstate"
key                  = "telesio-onboarding-lite.test.tfstate"
use_azuread_auth     = true
