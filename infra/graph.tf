# Ressources Graph gérées via le provider msgraph (extensions d'attribut, grant SharePoint).
#
# Les permissions Graph de l'identité managée ne sont plus posées par Terraform : affecter un rôle d'application exige
# AppRoleAssignment.ReadWrite.All, qui permettrait à l'identité d'apply de la CI de s'accorder n'importe quel droit Graph.
# Elles sont attribuées par un administrateur avec scripts/grant-app-roles.sh, qui porte la liste (GRAPH_APP_ROLES).
# Le bloc removed retire les affectations existantes de l'état sans les supprimer d'Entra.
removed {
  from = azuread_app_role_assignment.graph

  lifecycle {
    destroy = false
  }
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

# Attribut d'extension licenceOnboarding : skuId choisi par RH, lu à la validation pour viser le bon groupe.
# Même mécanique que statutOnboarding (nom complet extension_<appId>_licenceOnboarding renvoyé par Graph).
# Date d'activation du compte (ISO 8601 UTC), écrite à l'activation : référence de « mot de passe changé après l'activation ».
resource "msgraph_resource" "activation_extension" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "activationOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  # Graph bloque la création de plusieurs extensions en parallèle sur la même application : une à la fois (voir README).
  depends_on = [msgraph_resource.status_extension]

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

resource "msgraph_resource" "license_extension" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "licenceOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  # Graph bloque la création de plusieurs extensions en parallèle sur la même application : une à la fois (voir README).
  depends_on = [msgraph_resource.activation_extension]

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

# objectId de la personne qui a saisi la demande (créateur), écrit à la création du compte, dans le même POST que le statut :
# sert à tracer l'auto-approbation (demande.auto_approbation) quand elle valide ou refuse sa propre demande. Même mécanique que statutOnboarding.
resource "msgraph_resource" "creator_extension" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "createurOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  # Graph bloque la création de plusieurs extensions en parallèle sur la même application : une à la fois (voir README).
  depends_on = [msgraph_resource.license_extension]

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

# Historique de l'onboarding : auteur et date de chaque étape, écrits dans le même PATCH que le statut (valeur « <objectId>|<date ISO> »,
# 65 caractères au plus pour 256 permis). La création vient de createdDateTime et de createurOnboarding ; la date du mot de passe
# et d'Authenticator viennent d'Entra. Aucune permission Graph de plus : User.ReadWrite.All écrit déjà les extensions du compte.
# Même mécanique que statutOnboarding (nom complet extension_<appId>_<nom> renvoyé par Graph). Les noms sont injectés dans
# ENTRA_HISTORY_*_EXTENSION (main.tf) : sans ces réglages l'app n'enregistre pas l'historique (jamais de 503).
# Création **séquentielle** : Graph bloque (jusqu'à 20 minutes constatées sur test) quand plusieurs extensions sont créées en parallèle
# sur la même application. Chaque extension dépend de la précédente (toute la chaîne : statut, activation, licence, créateur, puis
# les quatre de l'historique) ; ne pas passer ces ressources en for_each, qui les créerait ensemble.
resource "msgraph_resource" "history_validation" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "validationOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  depends_on = [msgraph_resource.creator_extension]

  # Détruire l'extension efface cette étape de l'historique de tous les comptes.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

moved {
  from = msgraph_resource.history_extension["validation"]
  to   = msgraph_resource.history_validation
}

resource "msgraph_resource" "history_activation" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "premiereActivationOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  depends_on = [msgraph_resource.history_validation]

  # Détruire l'extension efface cette étape de l'historique de tous les comptes.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

moved {
  from = msgraph_resource.history_extension["activation"]
  to   = msgraph_resource.history_activation
}

resource "msgraph_resource" "history_regeneration" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "regenerationOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  depends_on = [msgraph_resource.history_activation]

  # Détruire l'extension efface cette étape de l'historique de tous les comptes.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

moved {
  from = msgraph_resource.history_extension["regeneration"]
  to   = msgraph_resource.history_regeneration
}

resource "msgraph_resource" "history_termine" {
  url = "/applications/${azuread_application_registration.web.object_id}/extensionProperties"

  body = {
    name          = "termineOnboarding"
    dataType      = "String"
    targetObjects = ["User"]
  }

  response_export_values = {
    name = "name"
  }

  depends_on = [msgraph_resource.history_regeneration]

  # Détruire l'extension efface cette étape de l'historique de tous les comptes.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [body]
  }
}

moved {
  from = msgraph_resource.history_extension["termine"]
  to   = msgraph_resource.history_termine
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

}
