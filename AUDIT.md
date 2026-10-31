# AUDIT.md : audit du projet telesio-onboarding-lite

Branche : `audit/ecc-2026-10-31` (partie de `main` au commit `38541ac`). Session autonome du 2026-10-31.
Ce journal est mis à jour après chaque étape : une nouvelle session peut reprendre à la section « Reprise ».

## Reprise (état courant)

- Étape 1 (lecture et architecture) : faite.
- Étape 2 (audit ECC) : trois revues en cours (sécurité et Terraform, qualité backend et tests, front React).
- Étapes 3 à 6 : à faire.
- Référence de départ : lint, typecheck et tests verts (serveur 276 tests, front 302 tests).

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

(à compléter après les revues)

## 3. Corrigé

(à compléter)

## 4. Reste à faire

(à compléter)

## 5. Décisions

(à compléter)

## 6. Synthèse

(à compléter en fin de session)
