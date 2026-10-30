# Environnement de test : tenant telesiosandbox, abonnement telesio-test.
environment     = "test"
app_service_sku = "B1"
subscription_id = "1e2d79ca-f1df-4c56-9689-87d1516fef41"

upn_domain = "telesiosandbox.onmicrosoft.com"

# Site https://telesiosandbox.sharepoint.com/sites/onboarding, bibliothèque « Documents ».
sharepoint_site_id        = "telesiosandbox.sharepoint.com,2d8b30fc-31cb-4e5e-b1bb-78b695c96c2a,a9198d7e-8dbd-414c-8d0d-996331b8b957"
sharepoint_drive_id       = "b!_DCLLcsxXk6xu3i2lclsKn6NGam9jUxBjQ2ZYzG4uVfzh8EO915jQYBK01W-WkX0"
sharepoint_folder_pattern = "{nom} {prenom}"

# Grant write posé à la main via Graph Explorer (le jeton az n'a pas Sites.FullControl.All).
manage_sharepoint_grant = false

# Licences proposées à RH. Le tenant n'a qu'un seul SKU : Microsoft 365 Business Premium (SPB). Terraform crée un groupe par licence.
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

# Utilisateur RH de test (rh@telesiosandbox.onmicrosoft.com) et directeur@, qui porte le rôle Direction : tout porteur de ce rôle
# peut créer, valider et refuser des demandes (y compris les siennes, tracées), et activer. Les rôles se règlent aussi dans le portail Entra.
rh_principal_object_ids        = ["1ec27e9b-ae17-43a4-98e6-2be67f1dcaad"]
direction_principal_object_ids = ["3f972282-b072-4c41-9fd5-5bace4f6e059"]
