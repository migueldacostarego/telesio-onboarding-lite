# Telesio Onboarding Lite

MVP d'onboarding : RH saisit une demande, la direction valide, l'app prépare le compte Entra et un dossier SharePoint, puis RH active le compte le jour J.

## Flux

1. **Demande (RH).** RH saisit la demande (prénom, nom, poste, département, responsable, date d'arrivée).
2. **Validation (direction).** La direction voit la liste des demandes `EnAttente` et les valide ou les refuse.
3. **Préparation.** À la création, le compte Entra est **désactivé** (attributs natifs `employeeHireDate`, `manager`, `jobTitle`, `department`, `usageLocation` = `FR`). À la validation, l'app réserve la licence (voir « Licence »), ajoute le compte (toujours désactivé) au groupe des arrivants, puis crée le dossier SharePoint.
4. **Jour J.** RH clique sur « Activer » : le compte est activé (il est déjà dans le groupe des arrivants depuis la validation), un **mot de passe temporaire** est posé avec `forceChangePasswordNextSignIn: true`, affiché une seule fois et remis en main propre, puis le statut passe à `Actif`.
5. **Fin d'onboarding.** À la première connexion (PC en OOBE Autopilot ou n'importe quel service Microsoft), l'accès conditionnel du groupe des arrivants impose d'inscrire Microsoft Authenticator, puis Entra impose de changer le mot de passe (ordre constaté sur test le 2026-10-29). Quand le mot de passe a changé après la remise **et** qu'Authenticator est inscrit, RH voit l'onboarding terminé : le compte quitte le groupe des arrivants et le statut passe à `Terminé`. Tant que ce n'est pas le cas, l'écran RH affiche « onboarding non terminé » (mot de passe, Authenticator).

**Pas de base de données.** L'état vit dans Entra, dans l'attribut d'extension `statutOnboarding` : `EnAttente`, `Validé`, `Refusé`, `Actif` ou `Terminé`.

## API RH (étape 2)

Toutes les routes `/api` RH exigent le rôle d'application `RH` (Easy Auth, en-tête `X-MS-CLIENT-PRINCIPAL`). Sans Easy Auth actif, l'app répond 503 (l'en-tête serait falsifiable). Les écritures n'acceptent que `application/json`.

- `GET /api/annuaire?q=` : recherche du manager dans Entra (`$search` sur `displayName` et `mail`, comptes actifs, 10 résultats max). Retourne `id`, `displayName`, `mail`.
- `POST /api/demandes` : `{ prenom, nom, dateArrivee (AAAA-MM-JJ), poste, service, managerId }`.
  1. Vérifie le manager, génère l'UPN `prenom.nom@<UPN_DOMAIN>` (minuscules, sans accents ni espaces), suffixe 2, 3… si pris.
  2. Crée l'utilisateur (`accountEnabled=false`, mot de passe aléatoire non stocké), avec `statutOnboarding=EnAttente` et `licenceOnboarding` **dans le même `POST /users`** (aucun compte sans statut), puis `PUT manager/$ref` (réessayé tant que le compte n'est pas répliqué). Si le manager ne peut pas être posé, la demande existe quand même : 201 avec `avertissement: "manager_non_affecte"` (à poser dans Entra ; ne pas renvoyer la demande, ce qui créerait un doublon).
  3. 201 `{ id, userPrincipalName, statut }`, 400 `{ error, details }` si invalide, 409 si aucun UPN libre, 502 si Graph échoue (avec `etape`, et `id` du compte éventuellement créé).
- Prérequis Entra : l'extension de répertoire `statutOnboarding` doit exister (définie une fois sur une inscription d'application) ; `ENTRA_STATUS_EXTENSION` en porte le nom complet `extension_<appId sans tirets>_statutOnboarding`.

Traçabilité : événements personnalisés Application Insights (`demande.compte_cree`, `demande.echec`, `acces.refuse`…) avec l'objectId de l'acteur et de la cible, l'étape et le code d'erreur. Jamais de nom, UPN, terme de recherche ni mot de passe. L'auto-collecte HTTP/dépendances n'est volontairement pas activée (les URL contiendraient ces données).

## API Direction (étape 3)

Le valideur est défini par `DIRECTION_TYPE` + `DIRECTION_OBJECT_ID` : `user` (cette personne) ou `group` (membre, transitif, du groupe, vérifié par Graph `checkMemberGroups`). L'identité vient d'Easy Auth, comme pour RH. Non configuré ou vérification impossible : les routes répondent 503 (fail closed).

- `GET /api/demandes` : comptes avec `statutOnboarding=EnAttente` (nom, poste, service, manager, date d'arrivée ; 1 000 max (10 pages de 100), `tronque` l'indique).
- `POST /api/demandes/:id/valider` : licence d'abord (voir « Licence »), puis statut `Validé`, puis dossier SharePoint à la racine de `SHAREPOINT_DRIVE_ID` (site `SHAREPOINT_SITE_ID`), nommé selon `SHAREPOINT_FOLDER_PATTERN` (défaut `{nom} {prenom}`, caractères interdits retirés). Idempotent : un dossier existant est réutilisé (un fichier de même nom donne 502). Si SharePoint échoue, le statut reste `Validé` et la réponse est 502 avec `etape` ; **rappeler `valider` reprend uniquement le dossier** (`reprise: true`).
- `POST /api/demandes/:id/refuser` : `{ "motif": "…" }` obligatoire (500 car. max) ; le motif n'est tracé que par sa longueur et n'est conservé nulle part ; le compte est supprimé (corbeille Entra, récupérable 30 jours). Un échec de suppression laisse le compte `EnAttente` : on peut réessayer.
- 409 si le compte n'est pas un compte d'onboarding désactivé au bon statut (`valider` : `EnAttente`, ou `Validé` pour la reprise ; `refuser` : `EnAttente`). C'est le garde-fou qui empêche `refuser` de supprimer un autre compte.
- Les POST n'acceptent que `application/json` (corps `{}` suffisant pour `valider`).
- Homonymes : deux personnes au même `{nom} {prenom}` partageraient le dossier ; ajouter `{id}` au motif si le cas se présente.

## Licence (étape 6)

Licence **par groupe**, **choisie par RH** dans une liste déroulante du formulaire de demande. `LICENSES` est un tableau JSON `[{ "skuId", "libelle", "groupId" }]` : un SKU (`skuId` de `GET /subscribedSkus`, pas son `id`), son libellé affiché et son groupe de sécurité (appartenance affectée, non assignable à un rôle), un groupe par SKU (GUID valides, doublons refusés au démarrage). `ENTRA_LICENSE_EXTENSION` (`extension_<appId sans tirets>_licenceOnboarding`) est requis avec `LICENSES`. Exige Entra ID P1 (ou un SKU qui l'inclut) ; l'attribution aux membres est **asynchrone** côté Entra. `LICENSES` absent : les demandes, la liste et `valider` répondent 503 avant toute lecture.

**Cache.** `GET /api/licences` (affichage du formulaire RH) met `GET /subscribedSkus` en cache 60 s en mémoire, par instance, sans conserver les échecs. La création de demande et la validation direction relisent toujours en direct, et une validation ou un refus pour manque de licence vide le cache. Un changement fait hors de l'app (achat, attribution manuelle) peut donc mettre jusqu'à 60 s à apparaître dans la liste.

- `GET /api/licences` (RH) : `{ licences: [{ skuId, libelle, disponibles }] }`, `disponibles = enabled - consumedUnits` lu via `GET /subscribedSkus` (jamais négatif, 0 si le SKU est absent du tenant). Le groupe n'est pas exposé. Le formulaire affiche « libellé : N disponibles » et grise (désactive) les licences à 0.
- `POST /api/demandes` : champ `licence` (skuId) obligatoire. Hors liste : 400 (`details.licence`), aucune écriture. SKU à 0 : 409 « Aucune licence disponible » (`code : licence_indisponible`), aucune écriture. Sinon le skuId est stocké sur le compte dans l'extension `licenceOnboarding`, **avant** le statut (qui reste la dernière écriture). Pas de base de données.

`usageLocation = FR` est posé à la création du compte (sans lui Entra n'attribue rien) ; un compte créé avant cette étape doit recevoir `usageLocation` à la main, sinon `valider` répond 502 (`raison` typiquement `ProhibitedInUsageLocationViolation`). Une demande créée avant le choix de licence n'a pas d'extension `licenceOnboarding` : `valider` répond 409 (`code : licence_inconnue`), il faut la refuser et la recréer ; de même si le SKU stocké n'est plus dans `LICENSES`.

`valider` lit le compte (404 et 409 de statut inchangés), prend le SKU stocké sur le compte (extension `licenceOnboarding`, retrouvé dans `LICENSES`, sinon 409 `licence_inconnue`) et, **avant toute écriture**, avec le groupe de **ce** SKU :

1. Le compte porte déjà la licence sans erreur (reprise, tentative précédente) : rien à faire, pas de décompte. Sans ce cas, le compte compterait dans `consumedUnits` et la reprise serait refusée à tort.
2. Sinon `GET /subscribedSkus` : `prepaidUnits.enabled - consumedUnits`. À 0 (ou moins) : **409 « Aucune licence disponible »**, le statut ne change pas, rien n'est écrit. SKU absent du tenant : 503.
3. Ajout au groupe (un ajout répété n'est pas une erreur), puis lecture de `licenseAssignmentStates` (au plus 8 lectures, environ 30 s). Entrée `Active` : on continue (statut `Validé`, dossier). Entrée en erreur : le compte est **retiré du groupe**, puis 409 pour `CountViolation` (course entre deux validations), 502 avec `raison` pour les autres (`étape : licence_attribution`). Retrait impossible : 502 `licence_retrait_groupe`, à reprendre.
4. Pas d'entrée `Active` à l'issue des lectures : **202** `{ message: "Licence en cours d’attribution, revalidez dans une minute", code: "licence_en_cours", etape: "licence_verification" }` (ce n'est pas une erreur), statut inchangé, écran direction en avertissement, le compte **reste dans le groupe** ; rappeler `valider` le retrouve licencié et continue. Choix volontaire : le retirer ferait échouer en boucle un tenant dont le traitement dépasse 30 s.

L'écran direction affiche « Aucune licence disponible… » en évidence (bordure épaisse). Refuser un compte le supprime : la licence est libérée avec lui.

Traçabilité : `licence.groupe_ajout`, `licence.attribuee`, `licence.deja_attribuee`, `licence.indisponible` (avec `enabled` et `consumed`), `licence.refusee` (code d'erreur Entra), `licence.groupe_retrait`, `licence.verification_expiree` (dernière lecture : `lectures`, `entree`, `entrees`, `etat`, `erreur`, `parGroupe`, sans nom ni UPN), `licence.sku_introuvable`, `licence.non_choisie`, `licence.liste`, avec l'objectId du compte et les GUID du groupe et du SKU uniquement.

Terraform ([infra/licence.tf](infra/licence.tf)) : la variable `licenses` est une map `clé = { libelle, sku_id, group_id }`. Sans `group_id`, Terraform crée le groupe `sg-<nom>-licence-<clé>` (`azuread_group`) et lui attribue le SKU (`azuread_group_license`), en `prevent_destroy` (les détruire retire la licence de tous les comptes de ce SKU) ; avec `group_id`, il désigne un groupe existant et n'y pose rien (licence à poser dans le portail). `LICENSES` est généré à partir de la map ; l'extension `licenceOnboarding` est créée dans [infra/graph.tf](infra/graph.tf), comme `statutOnboarding`. Les membres ne sont pas déclarés dans Terraform : c'est l'app qui les ajoute. Dans le tenant de test il n'y a qu'un SKU (Business Premium) : le cas « SKU à 0 » n'y est couvert que par les tests unitaires.

## Activation, mot de passe temporaire et fin d'onboarding (étape 7)

Parcours de l'arrivant (réglages du tenant : [docs/reglages-tenant-onboarding.md](docs/reglages-tenant-onboarding.md), à faire à la main par un administrateur) : connexion avec l'adresse et le mot de passe temporaire (OOBE Autopilot en Entra join, ou n'importe quel service Microsoft), **inscription de Microsoft Authenticator imposée par l'accès conditionnel**, puis **changement du mot de passe imposé par Entra** (force d'authentification « Authenticator obligatoire » sur le groupe des arrivants). Le mot de passe posé à la création reste aléatoire, jamais stocké ni communiqué.

- `GET /api/activations` (RH, **lecture seule**) : comptes `Validé` (action `activer`, ou `attendre` avant la date d'arrivée) et **tous** les comptes `Actif` (action `regenerer`) tant que l'onboarding n'est pas `Terminé`, avec `onboarding: { motDePasse, authenticator, termine }` (`{ verification: "echec" }` si la lecture Graph d'un compte échoue : le reste de la liste n'est pas affecté). 1 000 comptes par statut au plus (10 pages de 100, `tronque`).
- `GET /api/suivi` (RH, **lecture seule**, pour l'écran de suivi) : `{ demandes, tronque }`, les demandes `EnAttente` (étape 1), `Validé` (2), `Actif` (3) et `Terminé` (4) dont l'**activation date de moins de 30 jours**, au plus **100 par statut** (`tronque` passe à `true` au-delà, ou si Graph tronque lui-même la liste). Par demande : `id`, `nom` (nom affiché), `poste`, `service`, `dateArrivee`, `statut`, `etape` et, pour `Actif` seulement, `onboarding` (même calcul qu'`activations` : `inspectOnboarding`, `{ verification: "echec" }` si la lecture d'un compte échoue). Ni manager, ni UPN. Aucune permission Graph nouvelle : `listByStatut`, `getOnboardingProgress` et `inspectOnboarding` existants, et le même 503 qu'`activations` si `ARRIVANTS_GROUP_ID` ou `ENTRA_ACTIVATION_EXTENSION` manque.
  - **Fenêtre des `Terminé`** : la date d'activation (extension `activationOnboarding`, à défaut création du compte pour un compte activé avant l'extension) n'est pas filtrable côté Graph (statut + date + `$expand` est refusé). Seuls les `Terminé` arrivés depuis moins de 90 jours (30 jours + 60 jours de délai possible entre l'arrivée et l'activation) sont lus un à un, puis filtrés sur l'activation : **un compte activé plus de 60 jours après sa date d'arrivée n'apparaît pas**. Tri de l'activation la plus récente à la plus ancienne. Une lecture en échec ne retire pas le compte de la liste (date inconnue, échec tracé `demande.echec`, étape `suivi_activation`).
  - Traçabilité : événement `suivi.liste` (objectId de l'acteur, nombre de résultats, `tronque`), jamais de nom ni d'UPN.
- `POST /api/demandes/:id/activer` (RH, corps `{}`) : 409 si le statut n'est pas `Validé` (`raison` : `deja_actif`, `onboarding_termine`, `statut`), si la date d'arrivée manque ou est dans le futur (comparée à « aujourd'hui » dans `TZ_METIER`, défaut `Europe/Paris`). Ensuite : `accountEnabled=true`, ajout au groupe des arrivants (déjà fait à la validation, rejoué sans effet), date de remise écrite dans l'extension `activationOnboarding`, mot de passe temporaire (`PATCH passwordProfile`, `forceChangePasswordNextSignIn: true`), puis statut `Actif`. Rejouable : après un échec le compte reste `Validé` et un nouvel « Activer » refait tout (le mot de passe déjà posé, jamais affiché, est remplacé).
- `POST /api/demandes/:id/regenerer` (RH, corps `{ "motif": "<code>" }`) : nouveau mot de passe temporaire (perdu, refusé). Le motif est **l'un de** `code_perdu`, `code_refuse`, `autre` et il est tracé tel quel (`demande.mdp_regenere`) ; pas de texte libre, qui pourrait contenir un nom (400 sinon). Comptes `Actif` activés seulement ; **409 une fois l'onboarding `Terminé`** (`onboarding_termine`). Remplace aussi un mot de passe déjà choisi par l'arrivant : il devra le changer de nouveau, et la référence repart de cette remise.
- `POST /api/demandes/:id/terminer` (RH, corps `{}`) : revérifie côté serveur (jamais sur la foi du client) que `lastPasswordChangeDateTime` est postérieur de **plus de 60 s** à la date de remise (la remise elle-même met à jour ce champ quelques secondes après ; repli sur la date de création du compte pour un compte activé avant l'extension) **et** qu'une méthode `microsoftAuthenticator` est inscrite, sinon 409 `onboarding_non_termine`. Puis : retrait du groupe des arrivants (seulement s'il en est encore membre : Graph répond 400 pour un non-membre), statut `Terminé` **en dernier**. Rejouable après un échec partiel. L'écran RH l'appelle seul pour les comptes dont l'onboarding est complet, après chaque chargement de la liste.
- Réponse d'`activer` et de `regenerer` : `{ id, statut, regeneration, motDePasseTemporaire }` (format `Kp7m-Xq4r-Tz9w-Hb3n`, sans 0, O, 1, l ni I). Le mot de passe n'existe que dans cette réponse : jamais tracé, jamais stocké, `Cache-Control: no-store` sur toute l'API et sur les pages. L'interface l'affiche une seule fois et le garde dans le DOM uniquement (ni URL ni stockage navigateur). S'il est refusé juste après la remise, réessayer une à deux minutes plus tard (réplication).
- Échec d'une étape : 502 avec `etape` (`activation_compte`, `groupe_arrivants`, `activation_date`, `mot_de_passe`, `statut`), sans mot de passe dans la réponse ; RH relance la même action.
- Double clic : une seule action à la fois par compte (valider, refuser, activer, régénérer, terminer) et une création à la fois par personne RH ; la seconde reçoit 409 `action_en_cours`. Verrou en mémoire ([src/lock.ts](src/lock.ts)) : valable sur une seule instance App Service. L'interface désactive aussi les boutons pendant chaque écriture.
- `ARRIVANTS_GROUP_ID` ou `ENTRA_ACTIVATION_EXTENSION` absent : les quatre routes répondent 503 sans rien écrire.
- Terraform : groupe `sg-<nom>-arrivants` ([infra/arrivants.tf](infra/arrivants.tf), `prevent_destroy`) et extension `activationOnboarding` ([infra/graph.tf](infra/graph.tf)), injectés dans `ARRIVANTS_GROUP_ID` et `ENTRA_ACTIVATION_EXTENSION`. Les comptes `Actif` restent visibles jusqu'à `Terminé`.
- Prérequis tenant : paramètres de sécurité par défaut désactivés, Authenticator activé pour tous les utilisateurs, force d'authentification « Authenticator obligatoire » et accès conditionnel sur le groupe des arrivants. Sans l'accès conditionnel, le changement de mot de passe reste imposé mais pas Authenticator. Si l'activation échoue en 502 `mot_de_passe` avec `http: 403`, donner aussi le rôle **Password Administrator** à l'identité managée.

## Easy Auth (Entra)

Terraform ([infra/entra.tf](infra/entra.tf), [infra/main.tf](infra/main.tf)) crée tout, sans secret ni jeton d'accès implicite (les ID tokens sont activés : Easy Auth exige le flux hybride) :

- l'inscription d'application, avec les rôles d'application `RH` et `Direction`, et son service principal (`app_role_assignment_required` : seuls les utilisateurs affectés à un rôle se connectent) ;
- un **credential fédéré** : l'identité managée de la Web App (émetteur `https://login.microsoftonline.com/<tenant>/v2.0`, sujet = objectId de l'identité, audience `api://AzureADTokenExchange`) remplace le secret client ;
- `authsettingsV2` : authentification obligatoire sauf `/healthz`, flux hybride `code id_token` (forcer `response_type=code` donne un 401 au callback : « no 'id_token' »), `client_secret_setting_name = OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID`, ce réglage d'application contenant le client ID de l'identité managée (pas celui de l'inscription), comme le décrit la documentation App Service.

Les rôles s'affectent par `rh_principal_object_ids` et `direction_principal_object_ids` (fichiers `envs/*.tfvars`) ou dans le portail. Le valideur `direction_object_id` reçoit **automatiquement** le rôle `Direction`, car `app_role_assignment_required` refuse à la connexion toute personne sans rôle. L'API n'exige pas ce rôle : le valideur reste déterminé par `DIRECTION_TYPE` et `DIRECTION_OBJECT_ID`.

Si le valideur est un groupe : l'affectation d'un rôle à un groupe exige Entra ID P1, et seuls les **membres directs** reçoivent le rôle. `checkMemberGroups` est transitif : un membre d'un sous-groupe passerait le contrôle de l'API mais serait bloqué à la connexion ; l'ajouter directement au groupe ou à `direction_principal_object_ids`.

L'identité managée sert à la fois d'assertion Easy Auth et d'identité d'appel à Graph : ne l'affecter à aucune autre ressource.

## Permissions Microsoft Graph

Application permissions accordées par Terraform ([infra/graph.tf](infra/graph.tf), `azuread_app_role_assignment`) à l'identité managée de l'App Service (suppression d'un compte : couverte par `User.ReadWrite.All`). Aucun secret : sur App Service (`IDENTITY_ENDPOINT` présent), l'app utilise `ManagedIdentityCredential` visé sur `AZURE_CLIENT_ID` (démarrage refusé s'il manque) ; en local, `DefaultAzureCredential` (`az login`).

| Permission | Pourquoi |
| --- | --- |
| `User.ReadWrite.All` | Créer le compte désactivé, écrire ses attributs et `statutOnboarding`, puis l'activer. |
| `User.Read.All` | Résoudre le manager et vérifier la disponibilité de l'email (UPN/mail) avant création. |
| `User-PasswordProfile.ReadWrite.All` | Poser le mot de passe temporaire le jour J (`PATCH /users/{id}` avec `passwordProfile`, `forceChangePasswordNextSignIn: true`) à l'activation et à la régénération. Plus étroite que `User.ReadWrite.All` pour ce champ, et remplace `UserAuthenticationMethod.ReadWrite.All` et `UserAuthMethod-TAP.ReadWrite.All` (retirées). Si Graph répond 403, ajouter le rôle d'annuaire **Password Administrator**, qui ne permet de réinitialiser que les comptes non administrateurs. **Sensible** : poser un mot de passe permet de prendre un compte. Garde-fous dans l'app : seulement sur un compte au statut `Validé` (jour J atteint) ou `Actif` non terminé, rôle RH, chaque remise tracée (objectIds, jamais le mot de passe). **Limite connue** : le statut est une extension que tout administrateur d'utilisateurs peut écrire ; avant la prod, restreindre l'app (unité administrative à gestion restreinte, ou refus des comptes ayant un rôle d'annuaire). |
| `UserAuthMethod-MicrosoftAuthApp.Read.All` | Lire les méthodes Microsoft Authenticator (`GET /authentication/microsoftAuthenticatorMethods`) pour décider que l'onboarding est terminé. Lecture seule, limitée à cette méthode. |
| `Sites.Selected` | Accès limité à **un seul** site SharePoint : créer les dossiers dans la bibliothèque `SHAREPOINT_DRIVE_ID`. Le grant explicite (rôle `write`, `POST /sites/{id}/permissions`) est posé par Terraform sur `sharepoint_site_id`, ou à la main si `manage_sharepoint_grant = false` (voir ci-dessous). |
| `GroupMember.ReadWrite.All` | Ajouter le compte au groupe de licence à la validation (retrait en cas de `CountViolation`), et au groupe des arrivants à la validation (retrait à `Terminé`). Couvre aussi `checkMemberGroups` (valideur de type `group`), ce qui remplace `GroupMember.Read.All`. **Sensible** : permet d'ajouter n'importe quel compte à n'importe quel groupe de sécurité du tenant qui n'est pas assignable à un rôle (donc d'en hériter les accès). Garde-fous dans l'app : seuls les groupes de `LICENSES` sont visés, seulement sur un compte d'onboarding désactivé au statut `EnAttente` ou `Validé`, validateur Direction, chaque ajout et retrait tracé. Un groupe assignable à un rôle resterait inaccessible (il exigerait `RoleManagement.ReadWrite.Directory`, volontairement non accordée). |
| `LicenseAssignment.Read.All` | `GET /subscribedSkus` : lire `prepaidUnits.enabled` et `consumedUnits` pour la liste de licences de RH et pour refuser avant toute écriture. C'est le moindre privilège de cette route ; `Organization.Read.All` (plus large) n'est pas nécessaire. Un 403 transitoire peut apparaître plusieurs heures après l'attribution du rôle (propagation côté Graph, constaté sur test) : il disparaît sans autre action. L'état de licence du compte (`licenseAssignmentStates`) se lit avec `User.Read.All`. |

## Front React (/app)

Socle posé (étape 2 du front) : aucun écran n'est migré. `/app` affiche l'accueil (en-tête « Telesio Onboarding », un lien par écran) ; les écrans `/app/demande`, `/app/activation` et `/app/direction` sont des pages « à venir » qui renvoient vers les pages actuelles `/demande`, `/activation` et `/direction`, **toujours en service** jusqu'à leur migration.

- **Code** : [web/](web/), un paquet npm à part (son `package-lock.json`, ses scripts). Vite 8, React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui (style `radix-vega`, `components.json`), React Router (`basename="/app"`), TanStack Query. Tests : Vitest, Testing Library, jsdom.
- **Build** : `npm run build` à la racine compile le serveur (`dist/`) puis le front dans `dist/web` (`web/vite.config.ts`, `base: '/app/'`, aucune ressource inlinée). Le paquet de déploiement (`dist`) l'emporte, `deploy.yml` vérifie que `dist/web/index.html` existe.
- **Service** ([src/routes/web.ts](src/routes/web.ts), monté avant les pages-coquilles) : fichiers statiques sous `/app`, repli sur `index.html` pour les GET/HEAD sans extension (routes du front), 404 pour un fichier absent (jamais du HTML à la place d'un script), 503 si le front n'est pas construit. `index.html` en `no-store`, `assets/` (nom à empreinte) en `private, max-age=31536000, immutable`. Easy Auth protège `/app` comme le reste ; les droits restent vérifiés par `/api`.
- **CSP de `/app`** : `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`. Ni nonce, ni `unsafe-inline`, ni CDN ; polices système. Contrôle Chrome headless (`/app/`, `/app/demande`, route inconnue) : aucun message en console, aucun élément `<style>` dans le DOM. Pas de toasts : `sonner` injecte un `<style>` à l'exécution, bloqué par cette CSP, il a été retiré. Les messages (erreurs, avertissements) s'affichent dans l'écran ou la ligne concernés avec le composant `alert` ; [web/src/components/ApiErrorAlert.tsx](web/src/components/ApiErrorAlert.tsx) en affiche une `ApiError`. Toute bibliothèque qui crée un `<style>` ou un `<script>` à l'exécution est à écarter. Les pages actuelles gardent leur CSP à nonce.
- **Client API** ([web/src/lib/api.ts](web/src/lib/api.ts)) : fetch same-origin, JSON, écritures en `Content-Type: application/json` (corps `{}` par défaut, sinon 415). Un succès est `{ kind: 'ok' }`. **202** : `{ kind: 'en_cours', data: { message, code, etape } }` (pas une erreur, alors que `fetch` le range dans `ok`). Les autres statuts lèvent `ApiError` avec `kind` (`invalide` 400/415, `non_autorise` 401/403, `introuvable` 404, `conflit` 409, `amont` 502, `indisponible` 503, `serveur`, `reseau` si fetch échoue, `session` si la réponse n'est pas du JSON ou si Easy Auth redirige) et les champs du back : `code`, `etape`, `raison`, `details`, `id`.
- **TanStack Query** ([web/src/lib/query.ts](web/src/lib/query.ts)) : une lecture est rejouée deux fois au plus, seulement sur `reseau`, `amont` ou `indisponible`. Une écriture n'est jamais rejouée et son résultat n'est pas gardé en cache (`gcTime: 0` : le mot de passe temporaire ne survit pas à l'écran qui l'affiche).
- **Composants shadcn** : `alert`, `badge`, `button`, `card`, `field`, `input`, `label`, `separator`, `table`. **`form` n'existe plus dans le registre shadcn** (entrée vide pour ce style) : `field` le remplace. `react-hook-form` et zod ne sont pas installés : ils viendront avec l'écran Demande. Le paquet `shadcn` n'est **pas** une dépendance (ses avis `npm audit` : `body-parser`, `deepmerge`). Pour ajouter un composant, lancer la CLI épinglée :

  ```bash
  cd web && npm_config_before=<date du jour - 7 j> npm_config_save_exact=true npx shadcn@4.22.1 add <composant>
  ```

  puis contrôler le diff, `grep '[\^~]' package.json` (aucun résultat attendu) et `npm audit`. Les variantes `data-*` de `shadcn/tailwind.css` utilisées par les composants sont recopiées dans `web/src/index.css` ; ses utilitaires (`scroll-fade`, `shimmer`, `no-scrollbar`, keyframes `accordion`) n'y sont pas : les ajouter si un composant en a besoin.
- **Paquet `cn`** (les composants importent `cn` depuis `cn`, remplaçant de `clsx` + `tailwind-merge`) : vérifié le 2026-10-29 qu'il appartient à shadcn. Le dépôt `shadcn-ui/cn` est dans la même organisation GitHub (id 139895814) que `shadcn-ui/ui` ; `npm view cn` donne pour seul mainteneur `shadcn <m@shadcn.com>` et la provenance npm (SLSA) atteste la publication depuis le workflow `release.yml` de `shadcn-ui/cn` ; le paquet `shadcn` lui-même en dépend ; environ 17 millions de téléchargements par semaine. Réserve : le nom `cn` existait depuis 2013 (versions 0.1.x d'un autre auteur) et les versions de shadcn datent de septembre 2026 (0.x, version la plus récente publiée le 2026-10-16). Pour revenir au standard : `lib/utils.ts` avec `clsx` et `tailwind-merge`, et `import { cn } from "@/lib/utils"` dans `components/ui/*`.
- **Charte graphique** : la charte Telesio n'est pas dans le dépôt. Seul le logo ([web/src/assets/telesio.svg](web/src/assets/telesio.svg), téléchargé depuis telesio.fr le 2026-10-29, couleurs d'origine) est en place, dans l'en-tête. Son texte est `#F0F5FF` (quasi blanc) : l'en-tête a donc le fond sombre neutre `bg-primary` de shadcn. Le fichier ne contient que deux éléments `svg` et `path`, ni script, ni lien externe, ni attribut `on*`, `href` ou `style`. Les autres jetons (couleurs, rayons) et la police système restent ceux, neutres, de shadcn (`web/src/index.css`), à remplacer quand la charte sera fournie.
- **Dépendances** : versions exactes (`web/.npmrc`, `save-exact`). Les 373 paquets du `package-lock.json` (transitives comprises) sont publiés depuis plus de 7 jours (installation avec `--before=2026-10-22`, puis relevé des dates dans le champ `time` du registre). `npm audit --prefix web` : 0 avis.

## Développement

Prérequis : Node.js 22 LTS (`.nvmrc`).

```bash
npm ci
npm ci --prefix web   # dépendances du front (web/)
npm run build         # serveur vers dist/, front vers dist/web
npm run lint          # serveur puis front
npm run typecheck     # serveur puis front
npm test              # serveur puis front
npm run dev           # build + démarre sur le port 3000 (front sous /app)
npm run dev --prefix web   # front seul avec rechargement à chaud, /api relayée vers le port 3000
```

## Infra et déploiement (Terraform)

[infra/](infra/) : Terraform 1.16.6, providers `azurerm` 5.10.0, `azuread` 3.10.0 et `microsoft/msgraph` 0.6.0, tous épinglés (publiés depuis plus de 7 jours) avec `.terraform.lock.hcl` versionné.

| Fichier | Contenu |
| --- | --- |
| `main.tf` | Groupe de ressources, identité managée user-assignée, Log Analytics (rétention 365 j) + Application Insights, plan et Web App Node 22 avec les réglages d'application et Easy Auth |
| `entra.tf` | Inscription d'application, rôles RH et Direction, credential fédéré, URI de redirection |
| `graph.tf` | Permissions Graph de l'identité managée, extension `statutOnboarding`, grant `write` sur le seul site SharePoint |
| `licence.tf` | Un groupe de licence par SKU et attribution du SKU (`LICENSES`) |
| `envs/<env>.tfvars`, `envs/<env>.backend.hcl` | Paramètres et état (clé dédiée par environnement) de `dev`, `test` et `prod` |

`ENTRA_STATUS_EXTENSION` reçoit le nom complet `extension_<appId>_statutOnboarding` renvoyé par Graph. L'extension est protégée par `prevent_destroy` : la supprimer efface le statut de tous les comptes d'onboarding.

### Prérequis

1. **Identités de la CI** (sans secret, inscriptions d'application avec credentials fédérés GitHub), créées par [scripts/bootstrap-oidc.sh](scripts/bootstrap-oidc.sh), une fois par environnement :
   - **apply** : `gh-telesio-onboarding-apply-<env>`, une par environnement, credential fédéré de sujet `repo:<org>/<repo>:environment:<env>`.
     - Azure : `Contributor` sur l'abonnement (création du groupe de ressources), `Storage Blob Data Contributor` sur le conteneur d'état ;
     - Graph (application) : `Application.ReadWrite.OwnedBy` (crée les inscriptions dont elle est propriétaire ; à remplacer par `Application.ReadWrite.All` si le premier apply la refuse ; elle rend l'identité propriétaire d'office des inscriptions qu'elle crée, d'où `manage_app_owner = false` dans `dev` et `prod`, vrai (défaut) pour un apply manuel comme `test`), `AppRoleAssignment.ReadWrite.All` (permissions Graph de l'identité managée et rôles RH/Direction), `Sites.FullControl.All` seulement si `sharepoint_site_id` est renseigné et `manage_sharepoint_grant` vaut `true` (le script ne l'attribue pas ; préférer `false`, comme en test).
   - Licence : Graph (application) `Group.Create`, `Group.Read.All` et `User.Read.All`, plus `LicenseAssignment.ReadWrite.All` (`azuread_group_license`, `POST /groups/{id}/assignLicense`). `Group.Create` et `User.Read.All` sont le minimum documenté du provider `azuread_group` (le créateur devient propriétaire du groupe) ; `Group.Read.All` s'y ajoute parce que le provider relit les groupes (filtre sur `displayName`) avant d'en créer un : sans lui, l'apply échoue en 403 « Could not check for existing groups » (constaté sur `dev`). Le droit est en lecture seule, déjà porté par l'identité de plan. Relancer le script avec `GRAPH_CONSENT=true` **avant** de fusionner : sans cela, l'apply de `dev` échoue en 403 dès que `licenses` est renseigné.
   - **plan** : `gh-telesio-onboarding-plan`, lecture seule, une seule pour tous les environnements, sujet `repo:<org>/<repo>:pull_request`.
     - Azure : `Reader` sur chaque abonnement, `Storage Blob Data Reader` sur le conteneur d'état, et le rôle personnalisé `Telesio Web App Config Reader` (une seule action, `Microsoft.Web/sites/config/list/action`) sur le **seul groupe de ressources de l'environnement** (`rg-telesio-onboarding-<env>`). `Reader` ne relit pas les réglages d'une Web App : sans cette action, le plan échoue en 403 dès que l'app existe. Elle expose les valeurs des réglages (chaîne d'ingestion Application Insights, identifiants de l'identité managée ; aucun secret par conception) au code d'une PR du dépôt. Le groupe est créé par Terraform : avant le premier apply, le script ne peut pas attribuer ce rôle ; le relancer après (ainsi qu'après toute recréation du groupe, qui supprime l'attribution) ;
     - Graph : `Application.Read.All`, plus `Group.Read.All` et `LicenseAssignment.Read.All` (relire le groupe de licence et son SKU). Si le plan échoue encore en 403 sur le groupe, la lecture des membres demande `User.Read.All` : à arbitrer, car ce droit lit tous les profils depuis le code d'une PR. Certaines lectures (dont les permissions de site) peuvent exiger davantage : à ajuster à la première exécution.
     - L'état contient les réglages de l'app (dont la chaîne d'ingestion Application Insights) : le code d'une PR du dépôt peut le lire avec cette identité.
2. **Consentement administrateur** : les permissions Graph exigent un consentement d'administrateur (`Privileged Role Administrator` ou `Global Administrator`). `GRAPH_CONSENT=true scripts/bootstrap-oidc.sh` les attribue avec le compte connecté ; sans cette variable, le script ne les attribue pas et le dit. L'attribution des permissions à l'identité managée par Terraform suppose que l'identité d'apply ait `AppRoleAssignment.ReadWrite.All` consenti.
3. **GitHub** (le script affiche les commandes `gh`) : variables de dépôt `AZURE_TENANT_ID`, `AZURE_CLIENT_ID_PLAN`, `AZURE_SUBSCRIPTION_ID_DEV`, `AZURE_SUBSCRIPTION_ID_PROD` ; environnements `dev` et `prod` avec les variables `AZURE_CLIENT_ID` et `AZURE_SUBSCRIPTION_ID`, et un déploiement limité à la branche `main`. Sur `prod`, activer **Required reviewers** : c'est ce qui protège l'apply de prod (décocher « Prevent self-review » s'il n'y a qu'un seul mainteneur). Aucun secret.
   - **prod inactif tant que `AZURE_SUBSCRIPTION_ID_PROD` est vide** : le plan de prod sort de la matrice de [infra-plan.yml](.github/workflows/infra-plan.yml) et le job `prod` de [deploy.yml](.github/workflows/deploy.yml) est ignoré (sans cela, référencer l'environnement `prod` le créerait sans protection).
4. **Tenant** : la politique de méthode d'authentification « Temporary Access Pass » doit être activée pour les comptes d'onboarding.

```bash
ENVIRONMENT=dev AZURE_TENANT_ID=<tenant> AZURE_SUBSCRIPTION_ID=<abonnement> scripts/bootstrap-oidc.sh
# puis, en tant qu'administrateur, pour les permissions Graph :
GRAPH_CONSENT=true ENVIRONMENT=dev AZURE_TENANT_ID=<tenant> AZURE_SUBSCRIPTION_ID=<abonnement> scripts/bootstrap-oidc.sh
```

Le script est idempotent, n'écrit aucun fichier et ne pose rien dans GitHub. Il lit le compte d'état dans `infra/envs/<env>.backend.hcl`, qui doit exister (voir ci-dessous).

### Bootstrap de l'état

À faire une fois par abonnement : [scripts/bootstrap-state.sh](scripts/bootstrap-state.sh) crée le groupe de ressources, le compte de stockage sans clé d'accès (authentification Entra uniquement, versions et suppression récupérable 30 jours), le conteneur `tfstate` et le rôle `Storage Blob Data Contributor` pour le compte connecté. Il est idempotent et affiche les valeurs du backend.

```bash
AZURE_TENANT_ID=<tenant> AZURE_SUBSCRIPTION_ID=<abonnement> scripts/bootstrap-state.sh
```

Le nom du compte dérive de l'abonnement : deux environnements du même abonnement (aujourd'hui `dev` et `test`) partagent le compte et le conteneur, et ne diffèrent que par la clé (`telesio-onboarding-lite.<env>.tfstate`). Les identités de la CI ont leurs rôles sur le conteneur : celle de dev peut donc lire et écrire l'état de test. Un abonnement distinct par environnement (prod) donne un compte distinct.

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

- [.github/workflows/ci.yml](.github/workflows/ci.yml) : build, lint, tests de l'app et du front (`web/`).
- [.github/workflows/infra-plan.yml](.github/workflows/infra-plan.yml) : sur PR touchant `infra/`, `fmt`, `validate` et `plan` de dev (et de prod dès que `AZURE_SUBSCRIPTION_ID_PROD` est renseignée) avec l'identité de lecture seule.
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) : sur `main`, build de l'app (front compris, dans `dist/web`), puis `dev` (apply automatique puis déploiement), puis `prod` (même chose, après approbation de l'environnement ; ignoré tant que `AZURE_SUBSCRIPTION_ID_PROD` est vide). La logique commune est dans [release-environment.yml](.github/workflows/release-environment.yml) ; le déploiement termine par un contrôle de `/healthz`.

L'apply de prod re-planifie après approbation : relire le plan de la PR avant de merger.

### Limites connues

`terraform fmt` et `terraform validate` passent. `plan` et `apply` ont été exécutés sur l'environnement `test` seulement (`dev` et `prod` : jamais ; `dev` est configuré pour le tenant de test, `prod` n'est pas configuré). Le zip deploy fonctionne avec l'authentification de base désactivée. La relecture Graph de l'extension d'attribut renvoie le nom complet : `ignore_changes = [body]` évite une dérive permanente. À surveiller sur `dev` et `prod` : la relecture Graph du grant de site (si `manage_sharepoint_grant = true`) et le délai de propagation du credential fédéré avant la première connexion.

Dépendances : versions épinglées, publiées depuis plus de 7 jours au moment de l'installation (`npm install --before=<date du jour - 7 j>`).

## Dépendances : npm audit

Règle : correctif appliqué seulement si la version corrigée a plus de 7 jours.

- `body-parser` (via express), DoS sur corps compressé : corrigé en 2.4.0, publiée le 2026-10-22, donc **non appliqué**. Atténuation en place : les parseurs sont en `inflate: false` (corps compressé refusé, 415).
- `@azure/msal-node` (via `@azure/identity`), fuite de paramètres dans le flux « authorization code » : corrigé en 7.1.0 (publiée le 2026-10-13, assez ancienne), mais `@azure/identity@4.14.0` exige `^6.0.0`. Le correctif demanderait un `overrides` vers une version majeure non prévue par identity, ou `--force` qui rétrograde identity : **non appliqué**. Exposition probable limitée : l'app s'authentifie par identité managée, pas par flux interactif (à confirmer à la lecture de l'avis).
- `web/` : `npm audit --prefix web` ne signale rien. Le paquet `shadcn` (qui portait 4 avis : `body-parser`, `deepmerge`) a été retiré des dépendances ; la CLI s'utilise par `npx shadcn@4.22.1`.
- À relancer quand `@azure/identity` accepte msal-node 7.x et quand body-parser 2.4.0 aura 7 jours (racine ; `web/` à relancer à chaque ajout de dépendance).
