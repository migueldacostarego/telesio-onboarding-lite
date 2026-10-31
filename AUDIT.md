# AUDIT.md : audit du projet telesio-onboarding-lite

Branche : `audit/ecc-2026-10-31` (partie de `main` au commit `38541ac`). Session autonome du 2026-10-31.
Ce journal est mis à jour après chaque étape : une nouvelle session peut reprendre à la section « Reprise ».

## Reprise (état courant)

- Étapes 1 (lecture, architecture), 2 (audit ECC), 3 (corrections critiques et hauts), 4 (tests) et 5 (nettoyage) : faites pour ce qui est listé en sections 3 et 4. La synthèse (étape 6) est en section 6.
- Vérifié depuis la racine, comme la CI : `npm run build`, `npm run lint`, `npm test` verts. Tests : serveur 312 (276 au départ), front 308 (302 au départ).
- Reste, par valeur décroissante : M13 (session expirée qui démonte la boîte du mot de passe), accessibilité (M14), tests de détail et du front (section 4), revue ECC du diff de cette branche contre `main` (non faite : les revues ECC ci-dessus portent sur le code de départ).
- Non refait : le contrôle Chrome de la CSP derrière le vrai routeur (règle du projet après tout ajout de composant). `LimiteErreur` n'utilise que `Alert` et `Button`, déjà présents, et n'ajoute ni `<style>` ni script ni `style` inline ; le contrôle reste à faire avant fusion.
- Non vérifié de bout en bout : la coupure de l'auto-collecte (S1). Le test lit `parseConfig()` ; rien ne prouve ici que `trackEvent` et `trackMetric` atteignent toujours Application Insights avec ces options. À contrôler sur `test` après le prochain déploiement : `customEvents` continue d'arriver, `requests` et `dependencies` restent vides pour les nouvelles lignes.
- PR : voir plus bas (URL ajoutée après ouverture).

## Règles de la session

- Pas de `terraform apply`, de déploiement ni d'action sur le tenant Entra ou Azure. Aucun secret, aucun réglage d'app modifié.
- Aucune dépendance ajoutée sans nécessité, et jamais une version publiée depuis moins de 7 jours.
- Lint, typecheck et tests verts après chaque commit ; un changement qui casse sans solution simple est annulé et noté ici.
- Aucune donnée personnelle dans ce document : objectId, noms et adresses réels n'y figurent pas.

## 1. Architecture

Parcours : RH saisit une demande, la direction valide, le compte Entra (désactivé, attributs natifs) et le dossier SharePoint sont créés, RH active le jour J (mot de passe temporaire remis en main propre, changement imposé par Entra, Authenticator imposé par l'accès conditionnel via le groupe des arrivants), puis une tâche du serveur passe le compte à Terminé. Pas de base de données : l'état vit dans l'extension Entra `statutOnboarding` (EnAttente, Validé, Actif, Terminé).

### Serveur (Node 22, TypeScript strict, Express 5)

| Module | Rôle |
|---|---|
| `server.ts`, `app.ts` | Démarrage, routes `/healthz`, `/app` (front), `/api`, gestionnaire d'erreurs sans détail, tâche de terminaison, arrêt sur SIGTERM |
| `config.ts` | Lecture et validation des variables d'environnement (GUID, extensions, licences, historique : tout ou rien) |
| `auth.ts` | Lecture de `X-MS-CLIENT-PRINCIPAL` (Easy Auth), `droitsDe` (creer, approuver, activer, acces), gardes `requireAuthenticated` et `requireDroit` |
| `routes/api.ts` | Routes JSON : `moi`, `annuaire`, `demandes` (création, détail, valider, refuser, reprendre, activer, regenerer, terminer), `suivi`. JSON seulement (anti-CSRF), verrou par compte, `no-store` |
| `routes/web.ts` | Sert `dist/web` sous `/app` avec CSP stricte et nonce de style par requête sur `index.html` |
| `demandes.ts` | Création : licence du type de contrat, manager, UPN, compte désactivé avec statut, licence et créateur dans le même POST |
| `direction.ts` | Valider (licence, groupe des arrivants, statut, dossier SharePoint), refuser (suppression logique), reprendre le dossier ; `step` convertit toute erreur Graph en 502 nommant l'étape |
| `activation.ts` | Activer, régénérer le mot de passe temporaire, terminer ; contrôle d'onboarding (mot de passe changé après la remise et Authenticator inscrit) |
| `terminaison.ts` | Tâche récurrente (5 min) qui termine les comptes Actif dont l'onboarding est complet ; une seule instance |
| `licence.ts` | Réservation de licence par groupe, sondage de l'état d'attribution |
| `directory.ts` | Interface `Directory` et implémentation `GraphDirectory` (Graph) ; erreurs réduites à statut, code et message assaini |
| `sharepoint.ts`, `folder.ts` | Dossiers à la racine d'une bibliothèque (Sites.Selected), nom construit depuis un motif et assaini |
| `suivi.ts`, `detail.ts`, `history.ts` | Liste de suivi avec actions par demande, détail et chronologie (extensions d'historique optionnelles) |
| `audit.ts`, `graph.ts`, `tokenRoles.ts` | Événements d'audit vers Application Insights (jamais de nom ni d'UPN), client Graph en identité managée |
| `lock.ts`, `password.ts`, `upn.ts`, `validation.ts`, `dates.ts`, `typeContrat.ts` | Verrou en mémoire par clé, mots de passe (CSPRNG), identifiants, validation des entrées, fuseau métier |

### Front (`web/`)

Vite, React, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query. Servi sous `/app`. Écran « Demandes » (compteurs filtres, recherche, tri, actions par ligne), fenêtre « Nouvelle demande » (react-hook-form, zod en `jitless`), page de détail `/app/demandes/:id`. Droits lus dans `GET /api/moi`. Le mot de passe temporaire ne vit que dans le DOM (mutation sans observateur, `executerSensible`). CSP : aucun script ni style inline.

### Infrastructure (`infra/`, Terraform)

App Service Linux (Node 22) avec identité managée affectée par l'utilisateur, Easy Auth (authsettingsV2, connexion obligatoire sauf `/healthz`, secret remplacé par un credential fédéré), Application Insights, application Entra avec rôles RH et Direction, groupe des arrivants, extensions Entra créées une par une, groupes de licence, grant SharePoint Sites.Selected. Environnements `dev` (déployé par la CI), `test` (apply manuel), `prod` (inactif). CI : build, lint, tests ; déploiement en OIDC.

## 2. Constats

Sources : trois revues ECC en lecture seule (agents `security-reviewer`, `typescript-reviewer`, `react-reviewer`), dont chaque constat retenu ici a été relu dans le code (ou reproduit) avant correction. Statuts : **corrigé** (commit en section 3), **à faire**, **décision** (voir section 5).

### Critique

Aucun.

### Haute

| # | Constat | Statut |
|---|---|---|
| H1 | Auto-collecte Application Insights active par défaut (`applicationinsights` 3.17 : HTTP, SDK Azure, exceptions, performance, mesures en direct). Les URL (`/api/annuaire?q=<nom>`, filtres Graph avec UPN) partent dans `requests` et `dependencies`, contrairement à ce que disaient le README et `src/audit.ts`. Défauts confirmés par `parseConfig()`. L'effet réel en production n'est pas vérifiable ici : contrôler `requests` et `dependencies` dans Log Analytics et purger si besoin. | corrigé (S1) |
| H2 | L'identité d'apply de la CI porte `AppRoleAssignment.ReadWrite.All` (`scripts/bootstrap-oidc.sh`) : elle peut s'accorder n'importe quel rôle Graph (tier 0), et tout merge sur `main` lance un apply sur `dev` sans relecteur. Seule la discipline « ne jamais fusionner sans accord » protège. | à faire (hors périmètre : pas d'action tenant), voir 4 |
| H3 | Front : aucun error boundary. Un chunk manquant après redéploiement (formulaire « Nouvelle demande ») ou une réponse `/api/moi` sans `droits` donne une page blanche, boîte du mot de passe temporaire comprise. | corrigé (S8) |

### Moyenne

| # | Constat | Statut |
|---|---|---|
| M1 | Injection de paramètres OData dans `$search` (`GraphDirectory.search`) : le SDK Graph n'encode pas, `&` ajoute un paramètre, `#` coupe l'URL (le filtre `accountEnabled` disparaît). Reproduit hors réseau. Droit requis : `creer`. | corrigé (S2) |
| M2 | `reprendre` proposé par le suivi mais refusé en 409 pour un compte Validé déjà activé (activation partielle : compte activé, puis échec du mot de passe ou du statut). | corrigé (S3) |
| M3 | `GET /api/suivi` : lectures Graph des comptes Terminé sans borne de parallélisme (jusqu'à 1000 GET simultanés par appel, relu toutes les 30 s par onglet). | corrigé (S4) |
| M4 | `TERMINAISON_INTERVAL_MS` sans borne haute : au-delà de 2^31-1 ms, `setTimeout` se rabat sur 1 ms (boucle serrée contre Graph). | corrigé (S5) |
| M5 | En-têtes de sécurité absents hors CSP du front (`nosniff`, `Referrer-Policy`, HSTS, CORP). | corrigé (S6) |
| M6 | `body-parser` 2.3.0 (avis DoS sur corps compressé, haute) dans le verrou. Atténué par `inflate:false`. | corrigé (S7) |
| M7 | Contributor sur tout l'abonnement pour l'identité d'apply (`bootstrap-oidc.sh`) : équivaut, via Kudu ou l'affectation d'identité, aux droits Graph de l'identité managée ; dev et test partagent l'abonnement. | à faire, voir 4 |
| M8 | Statut `statutOnboarding` écrivable par un administrateur d'utilisateurs, et `activer`, `regenerer`, `valider`, `refuser` ne vérifient pas que le compte porte `createurOnboarding`. Déjà connu (avant la prod), durcissement possible. | décision D5 |
| M9 | Pas de séparation des tâches : Direction crée, valide, active (auto-approbation tracée, pas bloquée). | décision D2 |
| M10 | Adresse professionnelle libre (`comptabilite@`, `paie@`) sans lien avec le nom. | décision D6 |
| M11 | Compte Actif bloqué si l'arrivant change son mot de passe moins de 60 s après la remise (marge `MARGE_REMISE_MS` mesurée sur la date posée avant la réinitialisation) : jamais Terminé, jusqu'à une régénération. | à faire (compromis à trancher) |
| M12 | Homonymes : le motif `{nom} {prenom}` fait partager le dossier SharePoint de deux personnes de même nom (dossier existant réutilisé). Déjà mentionné dans le README ; à traiter avant la prod. | décision D4 |
| M13 | Front : session expirée en arrière-plan (`SessionExpired`) démonte la boîte du mot de passe temporaire, contredit DECISIONS-FRONT. | à faire |
| M14 | Front, accessibilité (**non traité**, seuls le lien https et le focus de fenêtre de la liste « Basse » ont été corrigés) : contrastes (texte secondaire sur fond d'accent environ 4,35:1 ; bordures de champs et focus sous 3:1), perte du focus après action ou fermeture de boîte, pas de changement de titre ni de focus à la navigation, zones `role="status"` montées déjà remplies, champs obligatoires non signalés, en-tête collant qui masque le focus. | à faire |

### Basse

- Corrigé dans la liste ci-dessous : `createur` filtré par `GUID_RE` (S9), route d'audit `acces.refuse` (S14), code mort `setExtension` et `STATUTS` de `config.ts`, doublon `GUID_RE`, casts d'`activation.ts`, commentaire `MAX_COMPTES`, apostrophe de config (S11), lien https et focus de fenêtre côté front (S12), quatre passages du README (S13). Restent :
- Back : `demande.auto_approbation` tracé avant l'issue de l'action (sur-déclaration) ; régénération qui écrit la date de remise avant `resetPassword` (compromis assumé, B1 de la revue) ; `MAX_COMPTES` de la terminaison (commentaire inexact, `listByStatut` déjà plafonné à 1000, `tronque` ignoré) ; SIGTERM n'attend pas le passage en cours ; branche inatteignable dans `createDemande` ; messages d'erreur incohérents (`Activation impossible` pour terminer et regenerer, 503 contre 409 pour un SKU absent, apostrophe droite dans un message de config, 413 rendu « Requête invalide ») ; verrou sans délai maximal ; `createur` non filtré par `GUID_RE` avant `getDisplayName` ; route d'audit `acces.refuse` construite sur le chemin brut.
- Back, qualité : code mort (`Directory.setExtension`, `STATUTS` et `StatutOnboarding` de `config.ts`) ; duplication (`GUID_RE`, horloge et `sleep` par défaut, 503 licences en double, `str` et `slice(0, 10)` dans `directory.ts`) ; casts évitables (`activation.ts` : `refuse` sans `: never`).
- Dépendances : `@azure/msal-node` 6.0.1 (avis haute, flux « authorization code » non utilisé ici : identité managée seulement) ; correctif dans `@azure/identity` 4.14.1, publié le 2026-10-29, applicable à partir du 2026-11-05 (règle des 7 jours) ; `minimatch` (outillage de lint, dev seulement, 11 avis modérés racine, 12 côté `web`).
- CI/CD : `id-token: write` au niveau du workflow (le job `build` n'en a pas besoin), `persist-credentials` non désactivé, `npm ci` sans `--ignore-scripts`, pas de `timeout-minutes`, sortie Terraform interpolée dans un `run`.
- Terraform : Application Insights sans `local_authentication_disabled`, `worker_count` non fixé alors que verrou et tâche supposent une instance, `User.Read.All` redondant avec `User.ReadWrite.All`, grant SharePoint `write` sur tout le site, compte d'état ouvert aux réseaux.
- Front : relecture à 5 s seulement depuis la liste ; `synchro.ts` garde des lignes (noms, UPN) après `queryClient.clear()` ; `annuaire` et `disponibilite` relancés à chaque focus de fenêtre ; lien du dossier SharePoint sans contrôle de schéma ; messages d'erreur techniques (clés et étapes brutes) ; erreur réseau sur Activer ou Régénérer sans mention que l'action a pu aboutir ; création sans effet sur un 202 ; titres des boîtes vides pendant l'animation de fermeture ; libellés incohérents (« Email pro », « E-mail », « email », « synchronisation… ») ; message « Demande créée » perdu à la navigation ; `ui/sheet.tsx` inutilisé ; `jsx-a11y` absent du lint.
- Documentation : README « sauf les siennes » contredit l'auto-approbation autorisée ; README « rôle RH » alors que la direction peut aussi activer ; README cite encore le TAP comme prérequis ; avis body-parser du README périmé.
- Couverture : voir la liste des cas manquants en section 4.

### Vérifié sans défaut (à ne pas « corriger »)

Authz (`droitsDe`, gardes avant validation de `:id`, 503 sans Easy Auth, contournement de dev ignoré en production) ; IDOR (GUID ancré, 404 hors demandes d'onboarding, `valider` et `refuser` exigent statut et compte désactivé) ; injection `upnTaken`, `listByStatut`, chemins SharePoint ; CSRF (`jsonOnly`, pas de CORS) ; CSP stricte avec nonce, `index.html` jamais en cache ; mot de passe temporaire (CSPRNG, environ 67 bits, jamais tracé, `no-store`, jamais dans cache, URL ni stockage côté front) ; journaux sans nom ni UPN (relu par la revue et par les tests) ; course entre la tâche de terminaison et les routes (verrou partagé, revérification sous verrou) ; minuteur de terminaison nettoyé ; Easy Auth et App Service durcis (connexion obligatoire, sauf `/healthz`, FTP et basic auth coupés, TLS 1.2) ; actions GitHub épinglées par SHA.

## 3. Corrigé

Commits de la branche `audit/ecc-2026-10-31`, tous avec lint, typecheck et tests verts :

| Réf. | Commit | Sujet |
|---|---|---|
| S7 | `7e50987` | body-parser 2.4.0 dans le verrou (publié le 2026-10-22, plus de 7 jours) |
| S6 | `2191c16` | En-têtes `nosniff`, `Referrer-Policy`, HSTS, CORP sur toutes les réponses (test `entetes.test.ts`) |
| S3 | `0597273` | `reprendre` accepte un compte Validé déjà activé (2 tests) |
| S5 | `36a4930` | Plafond de 24 h pour `TERMINAISON_INTERVAL_MS` (test, README, `.env.example`) |
| S4 | `054bbfd` | Lectures Graph des Terminé bornées à 5 (`mapLimit` exporté, `maplimit.test.ts`) |
| S2 | `a887f5a` | Liste blanche du terme de recherche annuaire (3 tests) |
| S1 | `54b3490` | Auto-collecte Application Insights coupée (`audit.test.ts` ; effet de bout en bout non vérifié, voir Reprise) |
| S8 | `56b1c1e` | Front : `LimiteErreur` autour du formulaire chargé à la demande et des pages (les boîtes survivent), forme de `/api/moi` vérifiée (5 tests) |
| S9 | `d6b8c91` | Le créateur lu dans l'extension n'est un chemin Graph que s'il est un objectId (1 test) |
| S10 | `c48473d` | 14 tests : garde-fous d'activation, échecs partiels, régénération en échec, statut en échec à la validation, création refusée, annuaire, verrou |
| S11 | `c9c4872` | Nettoyage : code mort, `GUID_RE` partagé, casts évités, commentaire de la terminaison, apostrophe de config |
| S12 | `f08a57e` | Front : lien du dossier SharePoint seulement en https (1 test), pas de relance de l'annuaire au focus |
| S13 | `fc94f9e` | README : auto-collecte coupée, auto-approbation, prérequis TAP retiré, avis npm à jour |
| S14 | `8912e1d` | L'audit `acces.refuse` n'écrit pas un identifiant qui n'est pas un GUID (2 tests) |
| S15 | `348a286` | Tests de la terminaison : revérification incomplète, auteur `systeme` de l'historique |

## 4. Reste à faire

Voir aussi « Constats » (statut « à faire »). Cas de test encore manquants (la revue backend en listait 15 ; sont faits : garde-fous d'activation, échecs `groupe_arrivants` et `activation_date`, régénération en échec, statut en échec à la validation, création refusée par manager désactivé, homonymes et licences, annuaire trop long, verrou sur `valider`, `activer` et `regenerer`, terminaison revérifiée et auteur `systeme`) :

1. Détail : 502 `detail_lecture`, états de licence `en_cours`, `erreur`, `inconnu`, SKU retiré, auteur supprimé.
2. Marge de 60 s : fige le comportement actuel (M11), à inverser si la marge change.
3. Validation : échec du groupe des arrivants (sans casser le groupe de licence : prévoir un échec ciblé dans la fausse API), échec de lecture de licence.
4. Création : deux demandes simultanées du même acteur (verrou `creation:`), échec de `getUser` et de `upnTaken`, 404 du manager après tous les essais.
5. Suivi : liste des dossiers coupée au plafond de pages, nom de dossier impossible à former.
6. Gestionnaire d'erreurs : une exception non `ServiceError` donne 500 sans détail.
7. Front : perte du mot de passe sur 401 (M13), focus après action et fermeture de boîte, double soumission (double clic), relecture à 5 s depuis le détail, `queryClient.clear()` qui vide aussi `synchro.ts`, focus de fenêtre sans requête d'annuaire, alerte de création 502 visible.
8. E2E derrière le vrai routeur Express avec une fausse API : aucun `securitypolicyviolation` ni message console (aujourd'hui manuel, règle du projet).

Front, à faire (revue React) : M13 (garder la boîte du mot de passe montée tant que `remise` n'est pas fermée avant de basculer sur `SessionExpired`, en gardant le vidage du cache après fermeture) ; accessibilité M14 (contrastes via `--muted-foreground`, `--input` et `--ring`, focus rendu à un élément stable après action, titre et focus à la navigation, `role="status"` persistant, `aria-required`, `scroll-padding-top`) ; messages d'erreur traduits (clés et étapes brutes) ; `jsx-a11y` dans le lint ; `ui/sheet.tsx` inutilisé.

Back, à faire : M11 (marge de 60 s), régénération qui écrit la date avant le mot de passe (B1), `demande.auto_approbation` tracé trop tôt, messages d'erreur à harmoniser (`Activation impossible`, 503 contre 409 pour un SKU absent, 413), délai maximal du verrou, `MAX_COMPTES` et `tronque` de la terminaison, passage en cours non attendu à l'arrêt, duplications restantes (horloge et `sleep` par défaut, 503 licences en double, `str` et `slice(0, 10)` de `directory.ts`).

Infra, hors périmètre de cette session (aucune action tenant) : retirer `AppRoleAssignment.ReadWrite.All` de l'identité d'apply ou protéger `dev` par relecteurs obligatoires et branche `main` protégée (H2) ; Contributor limité à un groupe de ressources (M7) ; `worker_count = 1` explicite ; `local_authentication_disabled` sur Application Insights ; vérifier dans Log Analytics ce que l'auto-collecte a déjà enregistré sur `test` et `dev` (H1) et purger si besoin ; README (tableau des permissions) : « rôle RH » alors que la direction active aussi.

## 5. Décisions

- D1. Les corrections ne touchent que le code, les tests et la documentation : aucun changement d'infra (apply interdit, et un merge sur `main` déploierait `dev`).
- D2. Auto-approbation : **non modifiée** (décision produit déjà prise et documentée). Recommandation : alerte Application Insights sur `demande.auto_approbation` et `demande.mdp_temporaire` hors horaires, ou second valideur quand `createur == acteur`.
- D3. Dépendances : `@azure/identity` 4.14.1 non appliqué (publié il y a moins de 7 jours) ; à refaire à partir du 2026-11-05. Aucune dépendance ajoutée.
- D4. Homonymes (M12) : non changé (modifier le motif de nom de dossier est une décision métier). Recommandation avant la prod : ajouter `{id}` au motif, ou refuser en 409 la première validation quand le dossier existe déjà (la reprise resterait idempotente).
- D5. Exiger `createurOnboarding` sur toutes les actions (M8) casserait les comptes antérieurs à l'extension : non fait, à décider avec une migration.
- D6. Adresse libre (M10) : non changé (le formulaire propose `prenom.nom`, la direction voit l'adresse). À décider : imposer le dérivé du nom ou une liste de noms réservés.
- D7. Marge de 60 s (M11) : non changée, compromis entre faux positif (la remise elle-même) et blocage ; à trancher avec une relecture de `lastPasswordChangeDateTime` après `resetPassword`.
- D8. Auto-collecte (H1) : coupée en réglant le client existant (`reglerTelemetrie`) plutôt qu'en changeant de mode d'initialisation, pour garder le chemin d'envoi déjà éprouvé en production.

## 6. Synthèse

### Prêt pour la production (côté code)

- Autorisations : droits calculés côté serveur, gardes avant toute validation d'identifiant, 503 sans Easy Auth, aucun contournement trouvé.
- Entrées : validation stricte, CSRF par `jsonOnly`, corps limité à 16 ko, plus l'injection de paramètres OData de l'annuaire corrigée (S2).
- Navigateur : CSP stricte avec nonce, en-têtes `nosniff`, `Referrer-Policy`, HSTS et CORP (S6), lien de dossier https seulement (S12), plus de page blanche (S8).
- Données personnelles : journaux sans nom ni UPN (relu et testé), auto-collecte de la télémétrie coupée (S1, à vérifier de bout en bout, voir Reprise), mot de passe temporaire jamais tracé ni mis en cache.
- Robustesse : reprises après échec partiel testées, `reprendre` possible après une activation partielle (S3), lectures Graph bornées (S4), plafond de la tâche de terminaison (S5).
- Qualité : 312 tests serveur et 308 tests front verts, build, lint et typecheck verts, code mort retiré.

### Bloque la migration vers le vrai tenant

1. **Identité d'apply de la CI** : `AppRoleAssignment.ReadWrite.All` (H2) et Contributor sur tout l'abonnement (M7). Un merge sur `main` applique `dev` sans relecteur : exiger des relecteurs sur l'environnement `dev`, protéger `main`, ou sortir les affectations de rôle de l'apply automatique.
2. **Statut en extension** : écrivable par tout administrateur d'utilisateurs, et les actions ne vérifient pas `createurOnboarding` (M8). Mettre les comptes d'onboarding dans une unité administrative à gestion restreinte et décider de l'exigence du créateur (D5).
3. **Télémétrie** : contrôler dans Log Analytics ce que l'auto-collecte a déjà enregistré sur `test` et `dev` (noms, UPN dans `requests` et `dependencies`) et purger ; confirmer que `customEvents` arrive toujours après le déploiement de S1.
4. **Une seule instance** : fixer `worker_count = 1` (verrou et tâche de terminaison en mémoire), ou prévoir un verrou partagé.
5. **Homonymes** : décider du motif de nom de dossier (ajouter `{id}`) ou du refus en 409 (D4).
6. **Parcours complet sur `test`** avec une vraie session sur `/app` : toujours pas fait (CLAUDE.md), ainsi que le contrôle Chrome de la CSP après S8.
7. **Décisions produit ouvertes** : auto-approbation et séparation des tâches (D2), adresses libres (D6), marge de 60 s (M11), session expirée et boîte du mot de passe (M13).
8. **Dépendances** : `@azure/identity` 4.14.1 à partir du 2026-11-05 (avis msal-node, flux non utilisé ici).
9. **Prod** : `upn_domain`, rôles et SharePoint des `tfvars` de prod encore vides.

### Recommandations prioritaires

1. Traiter H2 et M7 (aucun changement de code, mais ce sont les deux risques de plus fort impact).
2. Déployer sur `test`, puis vérifier la télémétrie (S1) et parcourir `/app` avec une vraie session.
3. Corriger M13 puis l'accessibilité (contrastes et focus), avec `jsx-a11y` au lint.
4. Trancher les décisions D2, D4, D5, D6 et M11 avant d'ouvrir le vrai tenant.
5. Après le 2026-11-05 : `@azure/identity` 4.14.1 (en vérifiant `npm audit`).
