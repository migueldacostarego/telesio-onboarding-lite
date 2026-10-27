# Telesio Onboarding Lite

MVP d'onboarding : RH saisit une demande, la direction valide, l'app prépare le compte Entra et un dossier SharePoint, puis RH active le compte le jour J.

## Flux

1. **Demande (RH).** RH saisit la demande (prénom, nom, poste, département, responsable, date d'arrivée).
2. **Validation (direction).** La direction voit la liste des demandes `EnAttente` et les valide ou les refuse.
3. **Préparation.** À la validation, l'app crée le compte Entra **désactivé** (attributs natifs `employeeHireDate`, `manager`, `jobTitle`, `department`) et le dossier SharePoint.
4. **Jour J.** RH clique sur « Activer » : le compte est activé, un TAP (Temporary Access Pass, usage unique) est généré et affiché une seule fois, remis en main propre, puis le statut passe à `Actif`.

**Pas de base de données.** L'état vit dans Entra, dans l'attribut d'extension `statutOnboarding` : `EnAttente`, `Validé`, `Refusé` ou `Actif`.

## API RH (étape 2)

Toutes les routes `/api` RH exigent le rôle d'application `RH` (Easy Auth, en-tête `X-MS-CLIENT-PRINCIPAL`). Sans Easy Auth actif, l'app répond 503 (l'en-tête serait falsifiable). Les écritures n'acceptent que `application/json`.

- `GET /api/annuaire?q=` : recherche du manager dans Entra (`$search` sur `displayName` et `mail`, comptes actifs, 10 résultats max). Retourne `id`, `displayName`, `mail`.
- `POST /api/demandes` : `{ prenom, nom, dateArrivee (AAAA-MM-JJ), poste, service, managerId }`.
  1. Vérifie le manager, génère l'UPN `prenom.nom@<UPN_DOMAIN>` (minuscules, sans accents ni espaces), suffixe 2, 3… si pris.
  2. Crée l'utilisateur (`accountEnabled=false`, mot de passe aléatoire non stocké), `PUT manager/$ref`, puis pose `statutOnboarding=EnAttente` **en dernier** : un compte resté sans statut après un échec n'est jamais une demande valide.
  3. 201 `{ id, userPrincipalName, statut }`, 400 `{ error, details }` si invalide, 409 si aucun UPN libre, 502 si Graph échoue (avec `etape`, et `id` du compte éventuellement créé).
- Prérequis Entra : l'extension de répertoire `statutOnboarding` doit exister (définie une fois sur une inscription d'application) ; `ENTRA_STATUS_EXTENSION` en porte le nom complet `extension_<appId sans tirets>_statutOnboarding`.

Traçabilité : événements personnalisés Application Insights (`demande.compte_cree`, `demande.echec`, `acces.refuse`…) avec l'objectId de l'acteur et de la cible, l'étape et le code d'erreur. Jamais de nom, UPN, terme de recherche ni mot de passe. L'auto-collecte HTTP/dépendances n'est volontairement pas activée (les URL contiendraient ces données).

## API Direction (étape 3)

Le valideur est défini par `DIRECTION_TYPE` + `DIRECTION_OBJECT_ID` : `user` (cette personne) ou `group` (membre, transitif, du groupe, vérifié par Graph `checkMemberGroups`). L'identité vient d'Easy Auth, comme pour RH. Non configuré ou vérification impossible : les routes répondent 503 (fail closed).

- `GET /api/demandes` : comptes avec `statutOnboarding=EnAttente` (nom, poste, service, manager, date d'arrivée ; 100 max, `tronque` l'indique).
- `POST /api/demandes/:id/valider` : statut `Validé`, puis dossier SharePoint à la racine de `SHAREPOINT_DRIVE_ID` (site `SHAREPOINT_SITE_ID`), nommé selon `SHAREPOINT_FOLDER_PATTERN` (défaut `{nom} {prenom}`, caractères interdits retirés). Idempotent : un dossier existant est réutilisé (un fichier de même nom donne 502). Si SharePoint échoue, le statut reste `Validé` et la réponse est 502 avec `etape` ; **rappeler `valider` reprend uniquement le dossier** (`reprise: true`).
- `POST /api/demandes/:id/refuser` : `{ "motif": "…" }` obligatoire (500 car. max) ; le motif n'est tracé que par sa longueur et n'est conservé nulle part ; le compte est supprimé (corbeille Entra, récupérable 30 jours). Un échec de suppression laisse le compte `EnAttente` : on peut réessayer.
- 409 si le compte n'est pas un compte d'onboarding désactivé au bon statut (`valider` : `EnAttente`, ou `Validé` pour la reprise ; `refuser` : `EnAttente`). C'est le garde-fou qui empêche `refuser` de supprimer un autre compte.
- Les POST n'acceptent que `application/json` (corps `{}` suffisant pour `valider`).
- Homonymes : deux personnes au même `{nom} {prenom}` partageraient le dossier ; ajouter `{id}` au motif si le cas se présente.

## Activation et TAP (étape 4)

- `GET /api/activations` (RH) : comptes `Validé` (action `activer`, ou `attendre` avant la date d'arrivée) et comptes `Actif` arrivés depuis moins de `TAP_REGEN_WINDOW_DAYS` jours (action `regenerer`).
- `POST /api/demandes/:id/activer` (RH, corps `{}`) : 409 si le statut n'est pas `Validé` ou si la date d'arrivée est dans le futur (comparée à « aujourd'hui » dans `TZ_METIER`, défaut `Europe/Paris`). Ensuite : `accountEnabled=true`, suppression du TAP existant s'il y en a un, création du TAP (`isUsableOnce`, `TAP_LIFETIME_MINUTES`, défaut 480), puis statut `Actif`.
- Réponse : `temporaryAccessPass`, `lifetimeInMinutes`, `startDateTime`, `isUsableOnce`. Le TAP n'existe que dans cette réponse : jamais tracé, jamais stocké, `Cache-Control: no-store` sur toute l'API et sur les pages. L'interface le garde dans le DOM uniquement (ni URL ni stockage navigateur).
- **Reprises** (écart volontaire avec « seulement si Validé ») : un compte `Validé` déjà activé (le TAP avait échoué) est accepté, et un compte `Actif` l'est aussi pour « Régénérer le TAP », **limité à `TAP_REGEN_WINDOW_DAYS` jours (défaut 7) après la date d'arrivée** : au-delà, 409. Sans cette limite, RH pourrait générer indéfiniment un accès temporaire sur n'importe quel compte actif.
- Échec du TAP ou du statut : 502 avec `etape`, sans TAP dans la réponse ; rappeler `activer` supprime le TAP orphelin et en recrée un.
- Prérequis tenant : la politique de méthode d'authentification « Temporary Access Pass » doit être activée pour les comptes concernés et accepter la durée choisie (sinon Graph répond 400).

### Pages

`/demande` (formulaire RH avec recherche du manager via `/api/annuaire`), `/direction` (valider, refuser avec motif), `/activation` (liste RH, boutons Activer et Régénérer, TAP affiché une fois). Les pages sont des coquilles sans donnée ; tout passe par `/api`. CSP stricte (script à nonce, aucune ressource externe). Le style est volontairement neutre : les Brand Guidelines Telesio ne sont pas appliquées.

## Easy Auth (Entra)

Terraform ([infra/entra.tf](infra/entra.tf), [infra/main.tf](infra/main.tf)) crée tout, sans secret ni flux implicite :

- l'inscription d'application, avec les rôles d'application `RH` et `Direction`, et son service principal (`app_role_assignment_required` : seuls les utilisateurs affectés à un rôle se connectent) ;
- un **credential fédéré** : l'identité managée de la Web App (émetteur `https://login.microsoftonline.com/<tenant>/v2.0`, sujet = objectId de l'identité, audience `api://AzureADTokenExchange`) remplace le secret client ;
- `authsettingsV2` : authentification obligatoire sauf `/healthz`, flux code, `client_secret_setting_name = OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID`, ce réglage d'application contenant le client ID de l'identité managée (pas celui de l'inscription), comme le décrit la documentation App Service.

Les rôles s'affectent par `rh_principal_object_ids` et `direction_principal_object_ids` (fichiers `envs/*.tfvars`) ou dans le portail. Le valideur `direction_object_id` reçoit **automatiquement** le rôle `Direction`, car `app_role_assignment_required` refuse à la connexion toute personne sans rôle. L'API n'exige pas ce rôle : le valideur reste déterminé par `DIRECTION_TYPE` et `DIRECTION_OBJECT_ID`.

Si le valideur est un groupe : l'affectation d'un rôle à un groupe exige Entra ID P1, et seuls les **membres directs** reçoivent le rôle. `checkMemberGroups` est transitif : un membre d'un sous-groupe passerait le contrôle de l'API mais serait bloqué à la connexion ; l'ajouter directement au groupe ou à `direction_principal_object_ids`.

L'identité managée sert à la fois d'assertion Easy Auth et d'identité d'appel à Graph : ne l'affecter à aucune autre ressource.

## Permissions Microsoft Graph

Application permissions accordées par Terraform ([infra/graph.tf](infra/graph.tf), `azuread_app_role_assignment`) à l'identité managée de l'App Service (suppression d'un compte : couverte par `User.ReadWrite.All`). Aucun secret : `DefaultAzureCredential` utilise l'identité managée sur Azure et `az login` en local.

| Permission | Pourquoi |
| --- | --- |
| `User.ReadWrite.All` | Créer le compte désactivé, écrire ses attributs et `statutOnboarding`, puis l'activer. |
| `User.Read.All` | Résoudre le manager et vérifier la disponibilité de l'email (UPN/mail) avant création. |
| `UserAuthenticationMethod.ReadWrite.All` | Lister, supprimer et créer le TAP (`/authentication/temporaryAccessPassMethods`) à l'activation et à la régénération. **Sensible** : permet de gérer les méthodes d'authentification de n'importe quel utilisateur, donc de prendre un compte. Garde-fous dans l'app : seulement sur un compte d'onboarding au statut `Validé` ou `Actif` récent, rôle RH, usage unique, chaque action tracée (objectIds, jamais le TAP). |
| `Sites.Selected` | Accès limité à **un seul** site SharePoint : créer les dossiers dans la bibliothèque `SHAREPOINT_DRIVE_ID`. Le grant explicite (rôle `write`, `POST /sites/{id}/permissions`) est posé par Terraform sur `sharepoint_site_id`, ou à la main si `manage_sharepoint_grant = false` (voir ci-dessous). |
| `GroupMember.Read.All` | `checkMemberGroups` : vérifier que le valideur appartient (même indirectement) au groupe `DIRECTION_OBJECT_ID`. Nécessaire seulement si `DIRECTION_TYPE=group`. |

## Développement

Prérequis : Node.js 22 LTS (`.nvmrc`).

```bash
npm ci
npm run build   # compile vers dist/
npm run lint
npm test
npm run dev     # build + démarre sur le port 3000
```

## Infra et déploiement (Terraform)

[infra/](infra/) : Terraform 1.16.6, providers `azurerm` 5.10.0, `azuread` 3.10.0 et `microsoft/msgraph` 0.6.0, tous épinglés (publiés depuis plus de 7 jours) avec `.terraform.lock.hcl` versionné.

| Fichier | Contenu |
| --- | --- |
| `main.tf` | Groupe de ressources, identité managée user-assignée, Log Analytics (rétention 365 j) + Application Insights, plan et Web App Node 22 avec les réglages d'application et Easy Auth |
| `entra.tf` | Inscription d'application, rôles RH et Direction, credential fédéré, URI de redirection |
| `graph.tf` | Permissions Graph de l'identité managée, extension `statutOnboarding`, grant `write` sur le seul site SharePoint |
| `envs/<env>.tfvars`, `envs/<env>.backend.hcl` | Paramètres et état (compte de stockage et clé dédiés) de `dev` et `prod` |

`ENTRA_STATUS_EXTENSION` reçoit le nom complet `extension_<appId>_statutOnboarding` renvoyé par Graph. L'extension est protégée par `prevent_destroy` : la supprimer efface le statut de tous les comptes d'onboarding.

### Prérequis

1. **Identité d'apply** (une par environnement, inscription d'application avec identifiants fédérés GitHub, sujets `repo:<org>/<repo>:environment:dev` et `:environment:prod`) :
   - Azure : `Contributor` sur l'abonnement (création du groupe de ressources), `Storage Blob Data Contributor` sur le compte d'état ;
   - Graph (application) : `Application.ReadWrite.All`, `AppRoleAssignment.ReadWrite.All` (permissions Graph de l'identité managée et rôles RH/Direction), `Sites.FullControl.All` (grant SharePoint, seulement si `sharepoint_site_id` est renseigné et `manage_sharepoint_grant` vaut `true`).
2. **Consentement administrateur** : ces permissions Graph exigent un consentement d'administrateur. Il doit être donné une seule fois, à la main, par un compte `Privileged Role Administrator` ou `Global Administrator` Entra. Même chose pour la permission `UserAuthenticationMethod.ReadWrite.All` : Terraform l'attribue à l'identité managée, ce qui suppose que l'identité d'apply ait `AppRoleAssignment.ReadWrite.All` consenti.
3. **Identité de plan** (lecture seule, une seule pour les PR, sujet `repo:<org>/<repo>:pull_request`) : `Reader`, `Storage Blob Data Reader` sur les états, et en lecture Graph au moins `Application.Read.All`. Certaines lectures (dont les permissions de site) peuvent exiger davantage : à ajuster à la première exécution.
4. **GitHub** : variables de dépôt `AZURE_TENANT_ID`, `AZURE_CLIENT_ID_PLAN`, `AZURE_SUBSCRIPTION_ID_DEV`, `AZURE_SUBSCRIPTION_ID_PROD` ; environnements `dev` et `prod` avec les variables `AZURE_CLIENT_ID` et `AZURE_SUBSCRIPTION_ID`. Sur l'environnement `prod`, activer **Required reviewers** : c'est ce qui protège l'apply de prod. Aucun secret.
5. **Tenant** : la politique de méthode d'authentification « Temporary Access Pass » doit être activée pour les comptes d'onboarding.

### Bootstrap de l'état

À faire une fois par environnement (compte de stockage sans clé d'accès, authentification Entra uniquement). Les noms doivent correspondre à `infra/envs/<env>.backend.hcl` (à adapter : un nom de compte de stockage est unique dans Azure).

```bash
ENV=dev; LOC=francecentral
RG=rg-telesio-tfstate-$ENV; SA=sttelesiotfstate$ENV
az group create -n $RG -l $LOC
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS \
  --min-tls-version TLS1_2 --allow-blob-public-access false --allow-shared-key-access false
az storage account blob-service-properties update --account-name $SA -g $RG --enable-versioning true
SCOPE=$(az storage account show -n $SA -g $RG --query id -o tsv)
az role assignment create --assignee <objectId de l'identité d'apply> --role "Storage Blob Data Contributor" --scope $SCOPE
az role assignment create --assignee <objectId de l'identité de plan> --role "Storage Blob Data Reader" --scope $SCOPE
# Pour créer le conteneur depuis votre compte, il faut aussi Storage Blob Data Contributor sur $SCOPE.
az storage container create --account-name $SA -n tfstate --auth-mode login
```

### Commandes

Terraform doit être en **1.16.6** (`required_version` exact). Sur Mac Apple Silicon, un binaire x86_64 (par exemple dans `/usr/local/bin`) échoue avec « bad CPU type » sans Rosetta : utiliser le binaire arm64 (`terraform_1.16.6_darwin_arm64.zip` sur releases.hashicorp.com).


```bash
cd infra
az login
export ARM_SUBSCRIPTION_ID=$(az account show --query id -o tsv)
terraform init -backend-config=envs/dev.backend.hcl      # autre environnement : -reconfigure avec prod.backend.hcl
terraform fmt -check -recursive && terraform validate
terraform plan  -var-file=envs/dev.tfvars
terraform apply -var-file=envs/dev.tfvars
```

Avant le premier apply : renseigner `upn_domain` dans `envs/<env>.tfvars` (l'app refuse de démarrer sans). `direction_*` et `sharepoint_*` peuvent rester vides (routes Direction fermées, pas de grant SharePoint) jusqu'à décision.

#### Grant SharePoint : géré par Terraform ou posé à la main

La variable `manage_sharepoint_grant` (défaut `true`) décide qui pose le grant `write` du site :

- `true` : Terraform le crée via `msgraph`. L'identité d'apply doit avoir `Sites.FullControl.All`.
- `false` : Terraform ne gère pas le grant. À utiliser quand l'apply tourne avec un jeton qui n'a pas ce droit (par exemple `az login`, dont le jeton n'a aucun scope `Sites.*` : l'erreur est un 403 `accessDenied`). Poser alors le grant une fois, avec un compte administrateur ayant consenti `Sites.FullControl.All` (Graph Explorer, par exemple) :

  `POST https://graph.microsoft.com/v1.0/sites/{sharepoint_site_id}/permissions`, corps `{"roles": ["write"], "grantedToIdentities": [{"application": {"id": "<managed_identity_client_id>", "displayName": "<nom de l'identité managée>"}}]}`

  `managed_identity_client_id` est une sortie Terraform. Vérifier ensuite avec `GET /sites/{id}/permissions`. Le grant n'est pas dans l'état Terraform : il survit à un `destroy` et doit être retiré à la main (`DELETE /sites/{id}/permissions/{permission-id}`).

L'environnement `test` utilise `false` ([envs/test.tfvars](infra/envs/test.tfvars)).

### CI/CD (OIDC, actions épinglées par SHA)

- [.github/workflows/ci.yml](.github/workflows/ci.yml) : build, lint, tests de l'app.
- [.github/workflows/infra-plan.yml](.github/workflows/infra-plan.yml) : sur PR touchant `infra/`, `fmt`, `validate` et `plan` de dev et prod avec l'identité de lecture seule.
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) : sur `main`, build de l'app, puis `dev` (apply automatique puis déploiement), puis `prod` (même chose, après approbation de l'environnement). La logique commune est dans [release-environment.yml](.github/workflows/release-environment.yml) ; le déploiement termine par un contrôle de `/healthz`.

L'apply de prod re-planifie après approbation : relire le plan de la PR avant de merger.

### Limites connues

`terraform fmt` et `terraform validate` passent. `plan` et `apply` ont été exécutés sur l'environnement `test` seulement (`dev` et `prod` : jamais). Le zip deploy fonctionne avec l'authentification de base désactivée. La relecture Graph de l'extension d'attribut renvoie le nom complet : `ignore_changes = [body]` évite une dérive permanente. À surveiller sur `dev` et `prod` : la relecture Graph du grant de site (si `manage_sharepoint_grant = true`) et le délai de propagation du credential fédéré avant la première connexion.

Dépendances : versions épinglées, publiées depuis plus de 7 jours au moment de l'installation (`npm install --before=<date du jour - 7 j>`).

## Dépendances : npm audit

Règle : correctif appliqué seulement si la version corrigée a plus de 7 jours.

- `body-parser` (via express), DoS sur corps compressé : corrigé en 2.4.0, publiée le 2026-10-22, donc **non appliqué**. Atténuation en place : les parseurs sont en `inflate: false` (corps compressé refusé, 415).
- `@azure/msal-node` (via `@azure/identity`), fuite de paramètres dans le flux « authorization code » : corrigé en 7.1.0 (publiée le 2026-10-13, assez ancienne), mais `@azure/identity@4.14.0` exige `^6.0.0`. Le correctif demanderait un `overrides` vers une version majeure non prévue par identity, ou `--force` qui rétrograde identity : **non appliqué**. Exposition probable limitée : l'app s'authentifie par identité managée, pas par flux interactif (à confirmer à la lecture de l'avis).
- À relancer quand `@azure/identity` accepte msal-node 7.x et quand body-parser 2.4.0 aura 7 jours.
