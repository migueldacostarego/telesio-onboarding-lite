# Permissions Microsoft Graph (application) de l'identité managée, et ressources Graph
# gérées via le provider msgraph (extension d'attribut, grant SharePoint).

data "azuread_service_principal" "msgraph" {
  client_id = "00000003-0000-0000-c000-000000000000" # Microsoft Graph
}

locals {
  graph_app_roles = [
    "User.ReadWrite.All",                     # créer et activer le compte, écrire statutOnboarding, supprimer
    "User.Read.All",                          # manager, disponibilité de l'UPN
    "GroupMember.Read.All",                   # checkMemberGroups (valideur de type group)
    "UserAuthenticationMethod.ReadWrite.All", # TAP (sensible)
    "Sites.Selected",                         # un seul site, via le grant ci-dessous
  ]
}

resource "azuread_app_role_assignment" "graph" {
  for_each = toset(local.graph_app_roles)

  app_role_id         = data.azuread_service_principal.msgraph.app_role_ids[each.value]
  principal_object_id = azurerm_user_assigned_identity.app.principal_id
  resource_object_id  = data.azuread_service_principal.msgraph.object_id
}

# Attribut d'extension statutOnboarding (EnAttente, Validé, Refusé, Actif) sur les utilisateurs.
# Le nom complet extension_<appId sans tirets>_statutOnboarding est renvoyé par Graph et
# injecté dans ENTRA_STATUS_EXTENSION (main.tf).
resource "msgraph_resource" "status_extension" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "statutOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  # Détruire l'extension efface le statut de tous les comptes d'onboarding.
  # Graph renvoie le nom complet (extension_<appId>_statutOnboarding) à la relecture : sans
  # ignore_changes, Terraform y verrait une dérive du body et tenterait de la modifier.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

# Sites.Selected n'ouvre aucun site tant qu'un grant explicite n'existe pas : rôle write sur le seul
# site SHAREPOINT_SITE_ID, pour l'identité managée (identifiée par son client ID).
# L'appelant (Terraform) doit pouvoir gérer les permissions du site (voir README), sinon
# manage_sharepoint_grant = false et le grant est posé à la main.
resource "msgraph_resource" "sharepoint_site_grant" {
  count = var.sharepoint_site_id != "" && var.manage_sharepoint_grant ? 1 : 0

  url = "/sites/${var.sharepoint_site_id}/permissions"

  body = {
    roles = ["write"]
    grantedToIdentities = [
      {
        application = {
          id          = azurerm_user_assigned_identity.app.client_id
          displayName = azurerm_user_assigned_identity.app.name
        }
      }
    ]
  }

  response_export_values = {
    id = "id"
  }

  depends_on = [azuread_app_role_assignment.graph]
}
