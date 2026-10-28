# Réglages du tenant pour l'onboarding (à faire à la main)

À faire avec un compte administrateur, rôle **Authentication Policy Administrator** au minimum, dans le centre d'administration Entra (https://entra.microsoft.com). Ces réglages concernent le tenant, pas le code : Terraform ne les pose pas (il faudrait donner à l'identité d'apply `Policy.ReadWrite.AuthenticationMethod`, un droit tenant très large). À refaire pour chaque tenant (test, dev, prod).

**À ne pas déployer avant** : tant que la politique TAP n'accepte pas 720 minutes en multi-usage, Graph refuse le TAP de l'activation (la durée maximale par défaut est de 8 h).

## 0. Relever l'état actuel (avant de changer quoi que ce soit)

L'état actuel de `telesiosandbox` n'a pas pu être lu depuis le CLI (403 sur `/policies/authenticationMethodsPolicy`). Notez, pour chacun des trois réglages ci-dessous, l'état et les cibles actuels. Seule la politique TAP est ciblée sur le groupe des arrivants ; Authenticator et SSPR sont ouverts à **tous les utilisateurs** (choix retenu), ce qui évite de perdre ces méthodes quand l'application retire la personne du groupe à `Terminé`.

## 1. Créer le groupe des arrivants (Terraform)

Le groupe `sg-telesio-onboarding-<env>-arrivants` est créé par `terraform apply` ([infra/arrivants.tf](../infra/arrivants.tf)) ; il doit exister avant d'être ciblé. Relever son objectId (`terraform output arrivants_group_id`). L'application y ajoute chaque compte **dès la validation par la direction** (compte encore désactivé), pour que l'appartenance soit répliquée avant le jour J ; elle l'en retire à `Terminé`.

## 2. Politique Temporary Access Pass

Entra ID, Authentication methods, Policies, **Temporary Access Pass**.

| Réglage | Valeur |
| --- | --- |
| Enable | Oui |
| Target | Select groups : `sg-telesio-onboarding-<env>-arrivants` |
| Minimum lifetime | 10 à 720 minutes (la valeur par défaut, 60, convient) |
| **Maximum lifetime** | **720 minutes ou plus** (8 h par défaut : insuffisant pour 12 h) |
| Default lifetime | 720 minutes |
| **One-time use** | **Non** (le TAP de l'activation est multi-usage ; « Oui » forcerait l'usage unique et Graph le refuserait) |
| Length | 8 (par défaut) |

Seuls les membres du groupe peuvent se connecter avec un TAP, même si Graph accepte d'en créer un pour n'importe quel compte.

## 3. Microsoft Authenticator

Entra ID, Authentication methods, Policies, **Microsoft Authenticator**.

| Réglage | Valeur |
| --- | --- |
| Enable | Oui |
| Target | **Tous les utilisateurs** |
| Authentication mode | Any |

Tous les utilisateurs : l'application retire l'arrivant du groupe des arrivants à `Terminé` ; avec une cible limitée à ce groupe, la personne perdrait à ce moment la méthode que l'application vient de vérifier.

## 4. Réinitialisation du mot de passe en libre-service (SSPR)

Entra ID, Password reset.

| Page | Réglage | Valeur |
| --- | --- | --- |
| Properties | Self service password reset enabled | **All** (tous les utilisateurs) |
| Authentication methods | Number of methods required to reset | **1** (l'arrivant n'a qu'Authenticator) |
| Authentication methods | Methods available to users | Mobile app notification, Mobile app code |
| Registration | Require users to register when signing in | **Oui** |
| Registration | Days before users are asked to reconfirm | 180 (au choix) |

SSPR pour des comptes cloud exige Entra ID P1 (inclus dans Business Premium). L'inscription obligatoire fait que l'arrivant, connecté avec le TAP dans un navigateur, est redirigé vers l'inscription combinée (Authenticator). SSPR restant ouvert à tous, la personne peut toujours réinitialiser son mot de passe après `Terminé`.

**Attention** : « Require users to register when signing in » = Oui s'applique alors à **tous** les utilisateurs du tenant, pas seulement aux arrivants : chacun sera invité à inscrire ses méthodes à sa prochaine connexion. À annoncer avant de l'activer, surtout en prod.

## 5. Inscription combinée et accès conditionnel

- L'inscription combinée (MFA et SSPR) est déjà active sur tous les tenants.
- Si une politique d'accès conditionnel cible l'action « Register security information » ou impose une force d'authentification, vérifier qu'elle accepte le TAP pour la première inscription.

## 6. Intune et Autopilot (hors de ce dépôt)

- Profil Autopilot **user-driven, Microsoft Entra join** (le TAP n'est pas pris en charge en hybride, ni sur les kiosques en self-deploying).
- Activer **Web sign-in** (`EnableWebSignIn`, Policy CSP Authentication) : le fournisseur de connexion natif de Windows ne gère pas le TAP.
- Un TAP multi-usage permet de le saisir une seconde fois pour Windows Hello for Business sans en redemander un.

## 7. Vérifier sur un compte de test

1. Activer le compte depuis l'écran RH : le TAP s'affiche une fois, « utilisable dans 5 minutes ».
2. Attendre 5 minutes, puis se connecter avec le TAP (https://mysignins.microsoft.com/security-info, ou OOBE Autopilot).
3. Inscrire Microsoft Authenticator, puis réinitialiser le mot de passe par SSPR (https://aka.ms/sspr).
4. Recharger l'écran RH : l'onboarding passe à terminé, le TAP est supprimé, le compte quitte le groupe des arrivants, le statut devient `Terminé`.

Deux points que la documentation ne tranche pas et qu'il faut observer :

- Le TAP déclenche-t-il l'obligation de changer le mot de passe (`forceChangePasswordNextSignIn: true`) à la première connexion ? Le TAP ne permet pas de changer un mot de passe que l'on ne connaît pas (la doc l'indique), d'où le passage par SSPR.
- Le lien « Réinitialiser le mot de passe » de l'écran de verrouillage Windows exige un réglage Intune (non vérifié ici) ; sinon utiliser https://aka.ms/sspr.
- Le TAP n'est utilisable que 5 minutes après l'activation (`TAP_START_DELAY_MINUTES`) : une connexion plus tôt échoue, ce n'est pas un défaut.

## Ordre de mise en œuvre

1. Relever l'état actuel (section 0) ; cibles retenues : TAP sur le groupe des arrivants, Authenticator et SSPR pour tous.
2. `terraform apply` (groupe des arrivants, extension `activationOnboarding`, rôles Graph granulaires).
3. Réglages des sections 2 à 4.
4. Déployer l'application, valider sur test (section 7).
5. Phase 2 Terraform : retirer `UserAuthenticationMethod.ReadWrite.All` une fois la validation faite avec les deux rôles granulaires.
