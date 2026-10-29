# Groupe des arrivants : ajouté à l'activation par l'application, retiré quand l'onboarding est Terminé.
# C'est la cible de l'accès conditionnel qui impose Microsoft Authenticator, réglé à la main par un administrateur
# (docs/reglages-tenant-onboarding.md) : elles ne s'appliquent qu'aux comptes en cours d'onboarding.
#
# Groupe de sécurité à appartenance affectée, jamais assignable à un rôle (même raison que les groupes de licence).
# `members` n'est volontairement pas déclaré : les membres sont gérés par l'application.
resource "azuread_group" "arrivants" {
  display_name            = "sg-${local.name}-arrivants"
  description             = "Comptes en cours d'onboarding (activés, onboarding non terminé) : cible de l'accès conditionnel qui impose Authenticator. Membres gérés par l'application."
  security_enabled        = true
  mail_enabled            = false
  assignable_to_role      = false
  prevent_duplicate_names = true

  # Détruire le groupe retire les arrivants du périmètre de l'accès conditionnel.
  lifecycle {
    prevent_destroy = true
  }
}
