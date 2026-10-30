environment     = "dev"
app_service_sku = "B1"

# L'app refuse de démarrer sans UPN_DOMAIN. dev vit dans le tenant de test.
upn_domain = "telesiosandbox.onmicrosoft.com"

# L'identité d'apply de la CI (Application.ReadWrite.OwnedBy) est propriétaire d'office de l'inscription.
manage_app_owner = false

# SharePoint : vide tant que non décidé (pas de grant).
sharepoint_site_id        = ""
sharepoint_drive_id       = ""
sharepoint_folder_pattern = "{nom} {prenom}"

# Licences proposées à RH : même tenant que test, mêmes SKU ; un groupe propre à dev créé par Terraform.
licenses = {
  business-premium = {
    libelle = "Business Premium"
    sku_id  = "cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46"
  }
}

# Licence de chaque type de contrat (clés de `licenses`). null = pas de licence prévue pour ce type : créer un tel type répond 409 « aucune
# licence disponible ». Le tenant n'a que Business Premium : Contractor reste à null. Dès que Business Basic est acheté : l'ajouter à `licenses`
# (business-basic, skuId de GET /subscribedSkus) et passer contractor à "business-basic".
license_by_type = {
  employe    = "business-premium"
  contractor = null
}

# Affectation des rôles d'application (objectIds d'utilisateurs ou de groupes). Tout porteur du rôle Direction peut créer,
# valider et refuser des demandes (y compris les siennes, tracées), et activer : le compte directeur de test le porte, comme sur test.
rh_principal_object_ids        = ["1ec27e9b-ae17-43a4-98e6-2be67f1dcaad"]
direction_principal_object_ids = ["3f972282-b072-4c41-9fd5-5bace4f6e059"]
