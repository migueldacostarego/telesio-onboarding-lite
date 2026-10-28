environment     = "prod"
app_service_sku = "P0v3"

# À renseigner avant le premier apply : l'app refuse de démarrer sans UPN_DOMAIN.
upn_domain = ""

# Valideur et SharePoint : vides tant que non décidés (routes Direction fermées, pas de grant).
direction_type      = ""
direction_object_id = ""

sharepoint_site_id        = ""
sharepoint_drive_id       = ""
sharepoint_folder_pattern = "{nom} {prenom}"

# Affectation des rôles d'application (objectIds d'utilisateurs ou de groupes).
rh_principal_object_ids        = []
direction_principal_object_ids = []
