environment     = "dev"
app_service_sku = "B1"

# L'app refuse de démarrer sans UPN_DOMAIN. dev vit dans le tenant de test.
upn_domain = "telesiosandbox.onmicrosoft.com"

# Valideur : le compte directeur de test (même valeur que test). SharePoint : vide tant que non décidé (pas de grant).
direction_type      = "user"
direction_object_id = "3f972282-b072-4c41-9fd5-5bace4f6e059"

sharepoint_site_id        = ""
sharepoint_drive_id       = ""
sharepoint_folder_pattern = "{nom} {prenom}"

# Affectation des rôles d'application (objectIds d'utilisateurs ou de groupes).
rh_principal_object_ids        = ["1ec27e9b-ae17-43a4-98e6-2be67f1dcaad"]
direction_principal_object_ids = []
