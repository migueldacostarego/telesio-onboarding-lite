terraform {
  # CLI épinglé : version publiée le 2026-10-14 (plus de 7 jours).
  required_version = "= 1.16.6"

  # Backend partiel : le compte de stockage et la clé d'état viennent de envs/<env>.backend.hcl
  # (un état par environnement). Auth Entra/OIDC, aucune clé d'accès.
  #   terraform init -backend-config=envs/dev.backend.hcl
  backend "azurerm" {}

  required_providers {
    # Versions épinglées, publiées avant le 2026-10-20 (plus de 7 jours à la date de rédaction).
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.10.0" # 2026-10-15
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "= 3.10.0" # 2026-09-24
    }
    msgraph = {
      source  = "microsoft/msgraph"
      version = "= 0.6.0" # 2026-10-01
    }
  }
}
