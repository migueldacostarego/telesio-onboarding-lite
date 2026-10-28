# Licence par groupe : RH choisit une licence dans la liste (var.licenses) ; à la validation direction l'app
# ajoute le compte au groupe de CE SKU, et Entra attribue la licence du groupe (traitement asynchrone).
# Exige Entra ID P1 (ou un SKU qui l'inclut). var.licenses vide : aucune licence proposée, l'app répond 503.

locals {
  # Un groupe créé ici par SKU, sauf si group_id désigne un groupe existant (alors aucune licence n'y est posée par Terraform).
  licenses_to_create = { for k, v in var.licenses : k => v if v.group_id == "" }

  license_group_ids = { for k, v in var.licenses : k => v.group_id != "" ? v.group_id : azuread_group.license[k].object_id }

  # LICENSES (lu par src/config.ts) : [{ skuId, libelle, groupId }] ; vide si aucune licence.
  licenses_json = length(var.licenses) == 0 ? "" : jsonencode([
    for k, v in var.licenses : {
      skuId   = lower(v.sku_id)
      libelle = v.libelle
      groupId = lower(local.license_group_ids[k])
    }
  ])
}

# Groupes de sécurité à appartenance affectée (pas dynamique), jamais assignables à un rôle : ajouter un
# membre à un groupe assignable à un rôle exigerait RoleManagement.ReadWrite.Directory pour l'identité managée.
# `members` n'est volontairement pas déclaré : les membres sont ajoutés par l'application, Terraform ne doit
# pas les retirer. Sans `owners`, l'identité qui applique en devient propriétaire.
resource "azuread_group" "license" {
  for_each = local.licenses_to_create

  display_name            = "sg-${local.name}-licence-${each.key}"
  description             = "Licence « ${each.value.libelle} » des comptes d'onboarding validés (ajout par l'application, licence par groupe)."
  security_enabled        = true
  mail_enabled            = false
  assignable_to_role      = false
  prevent_duplicate_names = true

  # Détruire le groupe retire la licence de tous les comptes d'onboarding de ce SKU.
  lifecycle {
    prevent_destroy = true
  }
}

resource "azuread_group_license" "onboarding" {
  for_each = local.licenses_to_create

  group_object_id = azuread_group.license[each.key].object_id
  sku_id          = each.value.sku_id

  lifecycle {
    prevent_destroy = true
  }
}

# Premier état (étape 6, une seule licence) : mêmes ressources, clé business-premium.
moved {
  from = azuread_group.license[0]
  to   = azuread_group.license["business-premium"]
}

moved {
  from = azuread_group_license.onboarding[0]
  to   = azuread_group_license.onboarding["business-premium"]
}
