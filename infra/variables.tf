variable "environment" {
  description = "Environnement cible."
  type        = string

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment doit valoir dev, test ou prod."
  }
}

variable "location" {
  description = "Région Azure."
  type        = string
  default     = "francecentral"
}

variable "subscription_id" {
  description = "Abonnement Azure. Laisser null pour lire ARM_SUBSCRIPTION_ID."
  type        = string
  default     = null
}

variable "name_suffix" {
  description = "Suffixe ajouté aux noms (le nom de la Web App doit être unique dans Azure)."
  type        = string
  default     = ""
}

variable "app_service_sku" {
  description = "SKU du plan App Service (Linux)."
  type        = string
}

variable "log_retention_days" {
  description = "Rétention Log Analytics, en jours (365 minimum)."
  type        = number
  default     = 365

  validation {
    condition     = var.log_retention_days >= 365
    error_message = "La rétention doit être d'au moins 365 jours."
  }
}

# --- Paramètres de l'application (mêmes noms que les variables d'environnement) ---

variable "upn_domain" {
  description = "Domaine des UPN générés, ex. contoso.com. Vide : l'app refuse de démarrer."
  type        = string
  default     = ""
}

variable "rh_role" {
  description = "Valeur du rôle d'application RH."
  type        = string
  default     = "RH"
}

variable "direction_role" {
  description = "Valeur du rôle d'application Direction (défini sur l'inscription ; non exigé par l'API)."
  type        = string
  default     = "Direction"
}

variable "direction_type" {
  description = "Valideur : user ou group. Vide : routes Direction fermées (503)."
  type        = string
  default     = ""

  validation {
    condition     = contains(["", "user", "group"], var.direction_type)
    error_message = "direction_type doit être vide, user ou group."
  }
}

variable "direction_object_id" {
  description = "objectId Entra de la personne ou du groupe valideur."
  type        = string
  default     = ""
}

variable "sharepoint_site_id" {
  description = "Id Graph du site SharePoint (hostname,siteCollectionId,webId). Vide : pas de grant ni de dossier."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[A-Za-z0-9!._,-]*$", var.sharepoint_site_id))
    error_message = "sharepoint_site_id contient des caractères interdits."
  }
}

variable "manage_sharepoint_grant" {
  description = "Terraform pose le grant write sur le site (exige Sites.FullControl.All pour l'identité d'apply). false : grant posé à la main, hors Terraform (voir README)."
  type        = bool
  default     = true
}

variable "sharepoint_drive_id" {
  description = "Id Graph de la bibliothèque (drive) du site."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[A-Za-z0-9!._,-]*$", var.sharepoint_drive_id))
    error_message = "sharepoint_drive_id contient des caractères interdits."
  }
}

variable "sharepoint_folder_pattern" {
  description = "Motif du nom de dossier : {nom}, {prenom}, {id}."
  type        = string
  default     = "{nom} {prenom}"
}

variable "license_sku_id" {
  description = "skuId (GUID) de la licence attribuée à la validation (GET /subscribedSkus, propriété skuId, pas id). Vide : pas de groupe de licence, valider répond 503."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?$", var.license_sku_id))
    error_message = "license_sku_id doit être un GUID."
  }
}

variable "license_group_id" {
  description = "objectId d'un groupe de sécurité existant porteur de la licence (licence par groupe déjà posée à la main). Vide : Terraform crée le groupe et lui attribue license_sku_id."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?$", var.license_group_id))
    error_message = "license_group_id doit être un GUID."
  }

  validation {
    condition     = var.license_group_id == "" || var.license_sku_id != ""
    error_message = "license_group_id exige license_sku_id."
  }
}

variable "tap_lifetime_minutes" {
  description = "Durée de vie du TAP en minutes (10 à 43200). La politique TAP du tenant doit l'accepter."
  type        = number
  default     = 480

  validation {
    condition     = var.tap_lifetime_minutes >= 10 && var.tap_lifetime_minutes <= 43200
    error_message = "tap_lifetime_minutes doit être compris entre 10 et 43200."
  }
}

variable "tap_regen_window_days" {
  description = "Jours après la date d'arrivée pendant lesquels RH peut régénérer un TAP."
  type        = number
  default     = 7
}

variable "time_zone" {
  description = "Fuseau qui définit le jour J."
  type        = string
  default     = "Europe/Paris"
}

# --- Affectation des rôles d'application (optionnelle) ---

variable "rh_principal_object_ids" {
  description = "objectIds d'utilisateurs ou groupes à qui affecter le rôle RH."
  type        = list(string)
  default     = []
}

variable "direction_principal_object_ids" {
  description = "objectIds d'utilisateurs ou groupes à qui affecter le rôle Direction."
  type        = list(string)
  default     = []
}

variable "manage_app_owner" {
  description = "Terraform ajoute l'identité d'apply comme propriétaire de l'inscription. false quand cette identité n'a que Application.ReadWrite.OwnedBy (CI) : elle devient propriétaire d'office en créant l'inscription et l'ajout échouerait (« already exists »)."
  type        = bool
  default     = true
}
