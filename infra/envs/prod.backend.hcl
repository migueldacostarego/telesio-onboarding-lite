# État Terraform de l'environnement prod : un compte de stockage et une clé dédiés.
# Auth Entra (pas de clé d'accès) : use_azuread_auth ici, OIDC via ARM_USE_OIDC en CI, az login en local.
# À renseigner : noms créés par le bootstrap (voir README).
resource_group_name  = "rg-telesio-tfstate-prod"
storage_account_name = "sttelesiotfstateprod"
container_name       = "tfstate"
key                  = "telesio-onboarding-lite.prod.tfstate"
use_azuread_auth     = true
