data "azuread_client_config" "current" {}

locals {
  name     = "telesio-onboarding-${var.environment}${var.name_suffix}"
  app_name = "app-${local.name}"
  issuer   = "https://login.microsoftonline.com/${data.azuread_client_config.current.tenant_id}/v2.0"

  tags = {
    application = "telesio-onboarding-lite"
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

# Identité managée user-assignée : appelle Graph (permissions dans graph.tf) et sert de
# credential fédéré à Easy Auth (entra.tf). Elle ne doit être affectée qu'à cette Web App.
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = local.tags
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = local.tags
}

resource "azurerm_service_plan" "main" {
  name                = "asp-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

locals {
  # Mêmes réglages que les variables d'environnement lues par src/config.ts.
  # Les valeurs vides sont omises : l'app les traite comme non configurées.
  app_settings_raw = {
    NODE_ENV                       = "production"
    SCM_DO_BUILD_DURING_DEPLOYMENT = "false" # le paquet déployé contient déjà dist/ et node_modules/

    # DefaultAzureCredential doit viser l'identité user-assignée.
    AZURE_CLIENT_ID = azurerm_user_assigned_identity.app.client_id

    # Easy Auth sans secret : l'identité managée sert d'assertion client (credential fédéré).
    # Valeur = client ID de l'identité managée, pas celui de l'inscription d'application.
    OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID = azurerm_user_assigned_identity.app.client_id

    # Chaîne d'ingestion (pas un secret d'accès).
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.main.connection_string

    UPN_DOMAIN             = var.upn_domain
    ENTRA_STATUS_EXTENSION = msgraph_resource.status_extension.output.name
    RH_ROLE                = var.rh_role
    TAP_LIFETIME_MINUTES   = tostring(var.tap_lifetime_minutes)
    TAP_REGEN_WINDOW_DAYS  = tostring(var.tap_regen_window_days)
    TZ_METIER              = var.time_zone

    DIRECTION_TYPE            = var.direction_type
    DIRECTION_OBJECT_ID       = var.direction_object_id
    SHAREPOINT_SITE_ID        = var.sharepoint_site_id
    SHAREPOINT_DRIVE_ID       = var.sharepoint_drive_id
    SHAREPOINT_FOLDER_PATTERN = var.sharepoint_folder_pattern
  }

  app_settings = { for k, v in local.app_settings_raw : k => v if v != "" }
}

resource "azurerm_linux_web_app" "main" {
  name                = local.app_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true
  tags                = local.tags

  # Pas d'identifiants de publication : le déploiement passe par Entra (OIDC), pas par basic auth.
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  site_config {
    always_on                         = true
    minimum_tls_version               = "1.2"
    ftps_state                        = "Disabled"
    http2_enabled                     = true
    health_check_path                 = "/healthz"
    health_check_eviction_time_in_min = 5

    application_stack {
      node_version = "22-lts"
    }
  }

  app_settings = local.app_settings

  # Easy Auth (authsettingsV2) : connexion Entra obligatoire sauf /healthz, flux code.
  # Le « secret » est l'identité managée : client_secret_setting_name pointe vers
  # OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID (voir la documentation App Service).
  auth_settings_v2 {
    auth_enabled           = true
    require_authentication = true
    require_https          = true
    unauthenticated_action = "RedirectToLoginPage"
    default_provider       = "azureactivedirectory"
    excluded_paths         = ["/healthz"]
    runtime_version        = "~1"

    active_directory_v2 {
      client_id                  = azuread_application_registration.web.client_id
      tenant_auth_endpoint       = local.issuer
      client_secret_setting_name = "OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID"
    }

    login {
      token_store_enabled = false
    }
  }

  depends_on = [azuread_application_federated_identity_credential.easyauth]

  # Azure ajoute ce tag tout seul quand Application Insights est relié : sans cela,
  # chaque plan proposerait de le retirer.
  lifecycle {
    ignore_changes = [tags["hidden-link: /app-insights-resource-id"]]
  }
}
