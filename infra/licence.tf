# Licence par groupe : l'app ajoute le compte au groupe à la validation direction ; Entra attribue
# alors la licence du groupe (traitement asynchrone). Exige Entra ID P1 (ou un SKU qui l'inclut).
# license_sku_id vide : rien n'est créé et l'app répond 503 à la validation (LICENSE_* non définis).

locals {
  license_enabled      = var.license_sku_id != ""
  create_license_group = local.license_enabled && var.license_group_id == ""

  # Groupe créé ici, ou groupe existant fourni (alors aucune licence n'est posée dessus par Terraform).
  license_group_id = !local.license_enabled ? "" : (var.license_group_id != "" ? var.license_group_id : azuread_group.license[0].object_id)
}

# Groupe de sécurité à appartenance affectée (pas dynamique), jamais assignable à un rôle : ajouter un
# membre à un groupe assignable à un rôle exigerait RoleManagement.ReadWrite.Directory pour l'identité managée.
# `members` n'est volontairement pas déclaré : les membres sont ajoutés par l'application, Terraform ne doit
# pas les retirer. Sans `owners`, l'identité qui applique en devient propriétaire.
resource "azuread_group" "license" {
  count = local.create_license_group ? 1 : 0

  display_name            = "sg-${local.name}-licence"
  description             = "Licence des comptes d'onboarding validés (ajout par l'application, licence par groupe)."
  security_enabled        = true
  mail_enabled            = false
  assignable_to_role      = false
  prevent_duplicate_names = true

  # Détruire le groupe retire la licence de tous les comptes d'onboarding.
  lifecycle {
    prevent_destroy = true
  }
}

resource "azuread_group_license" "onboarding" {
  count = local.create_license_group ? 1 : 0

  group_object_id = azuread_group.license[0].object_id
  sku_id          = var.license_sku_id

  lifecycle {
    prevent_destroy = true
  }
}
