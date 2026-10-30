environment     = "prod"
app_service_sku = "P0v3"

# À renseigner avant le premier apply : l'app refuse de démarrer sans UPN_DOMAIN.
upn_domain = ""

# L'identité d'apply de la CI (Application.ReadWrite.OwnedBy) est propriétaire d'office de l'inscription.
manage_app_owner = false

# SharePoint : vide tant que non décidé (pas de grant).
sharepoint_site_id        = ""
sharepoint_drive_id       = ""
sharepoint_folder_pattern = "{nom} {prenom}"

# Affectation des rôles d'application (objectIds d'utilisateurs ou de groupes).
rh_principal_object_ids        = []
direction_principal_object_ids = []
