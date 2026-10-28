output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "app_name" {
  description = "Nom de la Web App (cible du déploiement)."
  value       = azurerm_linux_web_app.main.name
}

output "app_url" {
  value = "https://${azurerm_linux_web_app.main.default_hostname}"
}

output "status_extension" {
  description = "Nom complet de l'attribut d'extension (ENTRA_STATUS_EXTENSION)."
  value       = msgraph_resource.status_extension.output.name
}

output "license_group_ids" {
  description = "objectId du groupe de licence de chaque licence proposée (clé de var.licenses)."
  value       = local.license_group_ids
}

output "license_extension" {
  description = "Nom complet de l'attribut d'extension licenceOnboarding (ENTRA_LICENSE_EXTENSION)."
  value       = msgraph_resource.license_extension.output.name
}

output "auth_app_client_id" {
  description = "Client ID de l'inscription Easy Auth."
  value       = azuread_application_registration.web.client_id
}

output "managed_identity_client_id" {
  value = azurerm_user_assigned_identity.app.client_id
}

output "managed_identity_principal_id" {
  value = azurerm_user_assigned_identity.app.principal_id
}
