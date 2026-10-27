# Authentification : aucune clé ni secret.
# - En local : `az login` (Azure CLI).
# - En CI : OIDC GitHub, via les variables d'environnement ARM_USE_OIDC, ARM_CLIENT_ID,
#   ARM_TENANT_ID et ARM_SUBSCRIPTION_ID (lues par les trois providers et par le backend).

provider "azurerm" {
  features {}

  subscription_id = var.subscription_id # null : lit ARM_SUBSCRIPTION_ID
}

provider "azuread" {}

provider "msgraph" {}
