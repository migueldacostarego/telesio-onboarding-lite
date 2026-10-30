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
  description = "Valeur du rôle d'application Direction (défini sur l'inscription). L'API s'en sert pour les droits : tous ceux de RH (creer, activer) plus approuver (valider ou refuser, y compris ses propres demandes, tracées)."
  type        = string
  default     = "Direction"
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

variable "licenses" {
  description = "Licences proposées à RH, par clé courte (minuscules, chiffres, tirets). sku_id : skuId (GUID) de GET /subscribedSkus, pas son id. group_id vide : Terraform crée le groupe de licence et lui attribue le SKU ; sinon objectId d'un groupe de sécurité existant porteur de la licence (rien n'y est posé). Vide : aucune licence, les demandes et la validation répondent 503."
  type = map(object({
    libelle  = string
    sku_id   = string
    group_id = optional(string, "")
  }))
  default = {}

  validation {
    condition     = alltrue([for k, v in var.licenses : can(regex("^[a-z0-9-]{1,32}$", k))])
    error_message = "Les clés de licences doivent être en minuscules, chiffres et tirets (32 caractères max)."
  }

  validation {
    condition     = alltrue([for v in values(var.licenses) : length(trimspace(v.libelle)) >= 1 && length(trimspace(v.libelle)) <= 64])
    error_message = "libelle : 1 à 64 caractères."
  }

  validation {
    condition = alltrue([
      for v in values(var.licenses) :
      can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", v.sku_id)) &&
      (v.group_id == "" || can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", v.group_id)))
    ])
    error_message = "sku_id et group_id doivent être des GUID (group_id peut être vide)."
  }

  validation {
    condition     = length(distinct([for v in values(var.licenses) : lower(v.sku_id)])) == length(var.licenses)
    error_message = "Un SKU ne peut apparaître qu'une fois."
  }
}

variable "license_by_type" {
  description = "Licence de chaque type de contrat (attribut natif employeeType), par clé de var.licenses : employe (« Employé ») et contractor (« Contractor »). RH ne choisit plus la licence : l'application la déduit du type. Chaque entrée est facultative : null (ou absente) = pas de licence prévue pour ce type, la création d'un tel type répond 409 « aucune licence disponible pour ce type de contrat ». Variable null : LICENCES_PAR_TYPE absent, la création de demande répond 503."
  type = object({
    employe    = optional(string)
    contractor = optional(string)
  })
  default = null

  validation {
    condition = var.license_by_type == null || alltrue([
      for k in [var.license_by_type.employe, var.license_by_type.contractor] : k == null || contains(keys(var.licenses), k)
    ])
    error_message = "employe et contractor doivent être null ou des clés de var.licenses."
  }
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
  description = "objectIds d'utilisateurs ou groupes à qui affecter le rôle Direction : tout porteur peut créer, activer, valider et refuser des demandes (y compris les siennes, tracées)."
  type        = list(string)
  default     = []
}

variable "manage_app_owner" {
  description = "Terraform ajoute l'identité d'apply comme propriétaire de l'inscription. false quand cette identité n'a que Application.ReadWrite.OwnedBy (CI) : elle devient propriétaire d'office en créant l'inscription et l'ajout échouerait (« already exists »)."
  type        = bool
  default     = true
}
