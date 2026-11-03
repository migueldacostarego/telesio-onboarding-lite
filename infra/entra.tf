# Inscription d'application pour Easy Auth, rôles RH et Direction, credential fédéré.
# Sans secret ni jeton d'accès implicite : Easy Auth utilise le flux hybride, avec l'identité managée
# comme assertion client.

locals {
  # Ids de rôles stables (dérivés du nom) : pas de nouvel id à chaque apply.
  rh_role_id        = uuidv5("dns", "rh.${local.name}")
  direction_role_id = uuidv5("dns", "direction.${local.name}")
}

# L'inscription utilise azuread_application_registration : c'est la seule compatible avec les
# ressources séparées azuread_application_redirect_uris et azuread_application_app_role
# (azuread_application les écraserait à chaque apply).
resource "azuread_application_registration" "web" {
  display_name                   = "app-${local.name}"
  sign_in_audience               = "AzureADMyOrg"
  requested_access_token_version = 2

  # Easy Auth utilise le flux hybride (response_type=code id_token) et refuse tout callback sans
  # id_token : les ID tokens doivent donc être activés (sinon 401 sur /.auth/login/aad/callback).
  # L'émission implicite de jetons d'accès reste désactivée.
  implicit_id_token_issuance_enabled     = true
  implicit_access_token_issuance_enabled = false
}

# Avec Application.ReadWrite.OwnedBy (identité d'apply de la CI), le créateur d'une inscription en devient
# propriétaire d'office : manage_app_owner = false évite alors un second ajout (erreur « already exists »).
resource "azuread_application_owner" "terraform" {
  count = var.manage_app_owner ? 1 : 0

  application_id  = azuread_application_registration.web.id
  owner_object_id = data.azuread_client_config.current.object_id
}

moved {
  from = azuread_application_owner.terraform
  to   = azuread_application_owner.terraform[0]
}

resource "azuread_application_app_role" "rh" {
  application_id       = azuread_application_registration.web.id
  role_id              = local.rh_role_id
  value                = var.rh_role
  display_name         = "RH"
  description          = "Saisit les demandes d'onboarding et active les comptes le jour J."
  allowed_member_types = ["User"]
}

resource "azuread_application_app_role" "direction" {
  application_id       = azuread_application_registration.web.id
  role_id              = local.direction_role_id
  value                = var.direction_role
  display_name         = "Direction"
  description          = "Valide ou refuse les demandes d'onboarding."
  allowed_member_types = ["User"]
}

resource "azuread_service_principal" "web" {
  client_id = azuread_application_registration.web.client_id
  owners    = [data.azuread_client_config.current.object_id]

  # Seuls les utilisateurs affectés à un rôle peuvent se connecter.
  app_role_assignment_required = true

  # L'owner enregistré est l'identité qui a appliqué (apply CI, ou la personne en local) ; le plan de PR tourne avec une
  # autre identité, en lecture seule, qui ne doit pas devenir owner (elle pourrait ajouter des secrets). Sans ceci, chaque
  # plan affiche un faux changement d'owners.
  lifecycle {
    ignore_changes = [owners]
  }
}

resource "azuread_application_redirect_uris" "web" {
  application_id = azuread_application_registration.web.id
  type           = "Web"
  redirect_uris  = ["https://${azurerm_linux_web_app.main.default_hostname}/.auth/login/aad/callback"]
}

# L'identité managée de la Web App peut obtenir un jeton pour cette inscription :
# émetteur Entra du tenant, sujet = objectId (principal) de l'identité managée.
resource "azuread_application_federated_identity_credential" "easyauth" {
  application_id = azuread_application_registration.web.id
  display_name   = "easyauth-${local.name}"
  description    = "Easy Auth : l'identité managée de la Web App remplace le secret client."
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = local.issuer
  subject        = azurerm_user_assigned_identity.app.principal_id
}

# Affectations des rôles RH et Direction : hors Terraform, pour la même raison que les permissions Graph de l'identité
# managée (graph.tf). scripts/grant-app-roles.sh les pose d'après rh_principal_object_ids et direction_principal_object_ids
# de envs/<env>.tfvars. Tout porteur du rôle Direction peut créer, activer, valider et refuser des demandes (y compris les
# siennes, tracées) : c'est cette affectation qui désigne la direction. Avec app_role_assignment_required, quiconque n'a
# aucun rôle est refusé à la connexion. Un groupe ne reçoit le rôle que s'il est direct (pas d'imbrication) et exige
# Entra ID P1.
removed {
  from = azuread_app_role_assignment.rh

  lifecycle {
    destroy = false
  }
}

removed {
  from = azuread_app_role_assignment.direction

  lifecycle {
    destroy = false
  }
}
