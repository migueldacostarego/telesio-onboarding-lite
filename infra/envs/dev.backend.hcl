# État Terraform de l'environnement dev : un compte de stockage et une clé dédiés.
# Auth Entra (pas de clé d'accès) : use_azuread_auth ici, OIDC via ARM_USE_OIDC en CI, az login en local.
# À renseigner : noms créés par le bootstrap (voir README).
resource_group_name  = "rg-telesio-tfstate-dev"
storage_account_name = "sttelesiotfstatedev"
container_name       = "tfstate"
key                  = "telesio-onboarding-lite.dev.tfstate"
use_azuread_auth     = true
