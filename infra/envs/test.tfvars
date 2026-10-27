# Environnement de test : tenant telesiosandbox, abonnement telesio-test.
environment     = "test"
app_service_sku = "B1"
subscription_id = "1e2d79ca-f1df-4c56-9689-87d1516fef41"

upn_domain = "telesiosandbox.onmicrosoft.com"

# Valideur : directeur@ (utilisateur). Il reçoit aussi le rôle d'application Direction.
direction_type      = "user"
direction_object_id = "3f972282-b072-4c41-9fd5-5bace4f6e059"

# Site https://telesiosandbox.sharepoint.com/sites/onboarding, bibliothèque « Documents ».
sharepoint_site_id        = "telesiosandbox.sharepoint.com,2d8b30fc-31cb-4e5e-b1bb-78b695c96c2a,a9198d7e-8dbd-414c-8d0d-996331b8b957"
sharepoint_drive_id       = "b!_DCLLcsxXk6xu3i2lclsKn6NGam9jUxBjQ2ZYzG4uVfzh8EO915jQYBK01W-WkX0"
sharepoint_folder_pattern = "{nom} {prenom}"

# Utilisateur RH de test (rh@telesiosandbox.onmicrosoft.com).
rh_principal_object_ids        = ["1ec27e9b-ae17-43a4-98e6-2be67f1dcaad"]
direction_principal_object_ids = []
