# Authentification : aucune clé ni secret.
# - En local : `az login` (Azure CLI).
# - En CI : OIDC GitHub, via les variables d'environnement ARM_USE_OIDC, ARM_CLIENT_ID,
#   ARM_TENANT_ID et ARM_SUBSCRIPTION_ID (lues par les trois providers et par le backend).

provider "azurerm" {
  features {}

  # Pas d'enregistrement des fournisseurs de ressources : il agit sur tout l'abonnement, alors que l'identité d'apply de
  # la CI n'a de droits que sur le groupe de ressources de l'environnement. Les fournisseurs utilisés (Web, Insights,
  # OperationalInsights, ManagedIdentity) sont déjà enregistrés ; sur un nouvel abonnement, les enregistrer à la main.
  resource_provider_registrations = "none"

  subscription_id = var.subscription_id # null : lit ARM_SUBSCRIPTION_ID
}

provider "azuread" {}

provider "msgraph" {}
