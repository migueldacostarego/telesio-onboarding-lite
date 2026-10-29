# Réglages du tenant pour l'onboarding (à faire à la main)

Ces réglages se font avec un compte administrateur (au minimum **Conditional Access Administrator** et **Authentication Policy Administrator**), dans le centre d'administration Entra (https://entra.microsoft.com). Ils concernent le tenant, pas le code : Terraform ne les pose pas, car il faudrait donner à l'identité d'apply des droits tenant très larges (`Policy.ReadWrite.ConditionalAccess`, `Policy.ReadWrite.AuthenticationMethod`). Ils sont à refaire pour chaque tenant (test, dev, prod).

Ce qu'on obtient : le jour J, RH remet un **mot de passe temporaire**. À la première connexion, sur un PC ou sur n'importe quel service Microsoft, Entra **impose de changer ce mot de passe**, puis l'accès conditionnel **impose d'inscrire Microsoft Authenticator** avant d'aller plus loin. L'application considère l'onboarding comme terminé quand les deux sont faits.

## 0. Relever l'état actuel (avant de changer quoi que ce soit)

Pour chacun des réglages ci-dessous, notez l'état et les cibles actuels. Vérifiez surtout les **paramètres de sécurité par défaut** (Entra ID, Overview, Properties, « Manage security defaults ») : l'accès conditionnel est impossible tant qu'ils sont actifs.

- En test : désactivez-les.
- En prod : avant de les désactiver, créez des politiques d'accès conditionnel équivalentes (MFA pour tous, blocage de l'authentification héritée). Sinon, le tenant perd la MFA imposée à tous.

## 1. Groupe des arrivants (Terraform)

Le groupe `sg-telesio-onboarding-<env>-arrivants` est créé par `terraform apply` ([infra/arrivants.tf](../infra/arrivants.tf)). Relevez son objectId avec `terraform output arrivants_group_id`. L'application y ajoute chaque compte **dès la validation par la direction**, alors que le compte est encore désactivé : l'appartenance a ainsi le temps de se répliquer avant le jour J. Elle l'en retire à `Terminé`.

## 2. Droit de poser le mot de passe temporaire

Terraform donne à l'identité managée la permission Graph `User-PasswordProfile.ReadWrite.All`. Si l'activation échoue à l'étape `mot_de_passe` avec `http: 403` (visible dans Application Insights, événement `demande.echec`), attribuez aussi un rôle à l'identité managée :

Entra ID, Roles and administrators, **Password Administrator**, Add assignments, puis choisissez l'identité `id-telesio-onboarding-<env>`.

Ce rôle ne permet de réinitialiser que le mot de passe des comptes non administrateurs. C'est aussi un garde-fou : l'application ne peut pas prendre la main sur un compte privilégié.

## 3. Microsoft Authenticator

Entra ID, Authentication methods, Policies, **Microsoft Authenticator**.

| Réglage | Valeur |
| --- | --- |
| Enable | Oui |
| Target | **Tous les utilisateurs** |
| Authentication mode | Any |

Ciblez tous les utilisateurs : à `Terminé`, l'application retire l'arrivant du groupe des arrivants. Avec une cible limitée à ce groupe, la personne perdrait à ce moment la méthode qu'elle vient d'inscrire.

## 4. Force d'authentification « Authenticator obligatoire »

Entra ID, Protection, Conditional Access, **Authentication strengths**, New authentication strength.

| Réglage | Valeur |
| --- | --- |
| Name | Authenticator obligatoire |
| Méthodes autorisées | **Password + Microsoft Authenticator (Push Notification)**, et **Microsoft Authenticator (Phone Sign-in)** |

Aucune autre méthode n'est cochée (ni SMS, ni appel, ni TAP).

## 5. Accès conditionnel « Arrivants : Authenticator obligatoire »

Entra ID, Protection, Conditional Access, Policies, **New policy**.

| Réglage | Valeur |
| --- | --- |
| Users, Include | Select users and groups : `sg-telesio-onboarding-<env>-arrivants` |
| Users, Exclude | Le ou les comptes d'urgence (break-glass) |
| Target resources | **All resources** (anciennement All cloud apps) |
| Grant | Grant access, **Require authentication strength** : `Authenticator obligatoire` |
| Enable policy | **On** (ou Report-only le temps d'un premier essai) |

Ne créez aucune politique qui bloque l'action « Register security information » pour ce groupe : l'arrivant doit pouvoir inscrire Authenticator juste après avoir changé son mot de passe.

## 6. Ce qui n'est plus nécessaire

- **Politique Temporary Access Pass** : l'application n'émet plus de TAP. Vous pouvez la désactiver, ou retirer le groupe des arrivants de ses cibles.
- **SSPR** : il ne sert plus au parcours, car le changement de mot de passe se fait à la première connexion. Il reste utile pour les mots de passe oubliés plus tard. Si vous l'activez, ne mettez pas « Require users to register when signing in » à Oui sans prévenir : ce réglage s'applique à tout le tenant.

## 7. Intune et Autopilot (hors de ce dépôt)

- Profil Autopilot **user-driven, Microsoft Entra join**. En OOBE, la personne saisit son adresse et le mot de passe temporaire, le change, puis inscrit Authenticator (accès conditionnel).
- Web sign-in n'est plus nécessaire : il servait au TAP.

## 8. Vérifier sur un compte de test

1. Créez une demande (RH) pour un compte neuf avec la date d'arrivée du jour, faites-la valider (direction), puis activez-la depuis l'écran RH. Le mot de passe temporaire s'affiche une seule fois.
2. Dans une fenêtre privée, connectez-vous sur https://myaccount.microsoft.com avec l'adresse et ce mot de passe. Si Entra le refuse, réessayez une à deux minutes plus tard (réplication).
3. Attendu : Entra demande un **nouveau mot de passe**, puis demande d'**inscrire Microsoft Authenticator**, puis vous arrivez sur la page.
4. Rechargez l'écran RH : l'onboarding passe à « Terminé », et le compte quitte le groupe des arrivants.

Un point reste à observer : au point 3, l'inscription d'Authenticator est-elle bien proposée directement ? Elle doit l'être d'après la documentation, pour les comptes sans méthode qui satisfait la force d'authentification. Si Entra bloque au lieu de proposer l'inscription, passez la politique en Report-only et consultez les journaux de connexion (Sign-in logs, onglet Conditional Access).
