#!/usr/bin/env bash
# Identités OIDC de la CI GitHub pour un environnement (dev ou prod), sans secret :
#   - gh-telesio-onboarding-plan : lecture seule, partagée par tous les environnements (PR) ;
#   - gh-telesio-onboarding-apply-<env> : droits de déploiement de l'environnement (apply + déploiement).
# Crée les inscriptions, les principaux de service, les credentials fédérés GitHub et les rôles Azure.
# Les permissions Graph ne sont attribuées qu'avec GRAPH_CONSENT=true (action d'administrateur).
# Idempotent : on peut le relancer sans effet si tout existe déjà. N'écrit aucun fichier, ne pose rien
# dans GitHub : il affiche les commandes `gh` à lancer.
#
# Prérequis : az login ; rôle Owner (ou User Access Administrator) sur l'abonnement, droit de créer des
# inscriptions d'application ; pour GRAPH_CONSENT=true, Privileged Role Administrator ou Global Administrator.
# Le compte d'état de l'environnement doit exister (scripts/bootstrap-state.sh) et infra/envs/<env>.backend.hcl
# doit désigner ce compte.
#
# Usage :
#   ENVIRONMENT=dev AZURE_TENANT_ID=<tenant> AZURE_SUBSCRIPTION_ID=<abonnement> scripts/bootstrap-oidc.sh
#
# Variables facultatives : GITHUB_REPO (<org>/<repo>, par défaut celui de `gh repo view`), GRAPH_CONSENT (false).
set -euo pipefail

: "${ENVIRONMENT:?Renseigner ENVIRONMENT (dev ou prod)}"
: "${AZURE_TENANT_ID:?Renseigner AZURE_TENANT_ID (tenant attendu)}"
: "${AZURE_SUBSCRIPTION_ID:?Renseigner AZURE_SUBSCRIPTION_ID (abonnement attendu)}"

case "$ENVIRONMENT" in
  dev | prod) ;;
  *) echo "ENVIRONMENT doit valoir dev ou prod (test s'applique à la main, pas en CI)." >&2; exit 1 ;;
esac

GRAPH_CONSENT="${GRAPH_CONSENT:-false}"
GITHUB_REPO="${GITHUB_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"
if [[ ! "$GITHUB_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "GITHUB_REPO invalide ou introuvable (attendu <org>/<repo>)." >&2
  exit 1
fi

PLAN_APP="gh-telesio-onboarding-plan"
APPLY_APP="gh-telesio-onboarding-apply-${ENVIRONMENT}"
ISSUER="https://token.actions.githubusercontent.com"
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
# Permissions Graph (application). Le plan ne lit que ; l'apply crée les inscriptions qu'il possède et
# attribue les rôles (permissions de l'identité managée, rôles RH/Direction).
PLAN_GRAPH_ROLES=(Application.Read.All)
APPLY_GRAPH_ROLES=(Application.ReadWrite.OwnedBy AppRoleAssignment.ReadWrite.All)

# Les journaux vont sur stderr : les fonctions renvoient leur résultat sur stdout.
log() { printf '> %s\n' "$*" >&2; }

# Garde-fou : aucune écriture avant d'avoir vérifié le contexte Azure.
current_tenant="$(az account show --query tenantId -o tsv)"
current_sub="$(az account show --query id -o tsv)"
if [[ "$current_tenant" != "$AZURE_TENANT_ID" || "$current_sub" != "$AZURE_SUBSCRIPTION_ID" ]]; then
  echo "Contexte az inattendu (tenant $current_tenant, abonnement $current_sub). Abandon." >&2
  exit 1
fi

# Compte d'état : lu dans le fichier de backend, source unique de vérité.
backend="$(cd "$(dirname "$0")/.." && pwd)/infra/envs/${ENVIRONMENT}.backend.hcl"
backend_value() { awk -F'"' -v k="$1" '$1 ~ "^"k"[ ]*=" { print $2 }' "$backend"; }
STATE_RG="$(backend_value resource_group_name)"
STATE_SA="$(backend_value storage_account_name)"
STATE_CONTAINER="$(backend_value container_name)"
if [[ -z "$STATE_RG" || -z "$STATE_SA" || -z "$STATE_CONTAINER" ]]; then
  echo "Lecture impossible du backend $backend." >&2
  exit 1
fi
state_scope="$(az storage account show -g "$STATE_RG" -n "$STATE_SA" --query id -o tsv)/blobServices/default/containers/${STATE_CONTAINER}"
sub_scope="/subscriptions/${AZURE_SUBSCRIPTION_ID}"

# Inscription d'application : renvoie son appId. Plusieurs inscriptions de même nom : abandon.
ensure_app() {
  local name="$1" ids count
  ids="$(az ad app list --display-name "$name" --query "[?displayName=='${name}'].appId" -o tsv)"
  count="$(printf '%s' "$ids" | grep -c . || true)"
  if [[ "$count" -gt 1 ]]; then
    echo "Plusieurs inscriptions nommées $name. Abandon." >&2
    exit 1
  fi
  if [[ "$count" == "1" ]]; then
    log "Inscription $name : existante"
    printf '%s' "$ids"
    return
  fi
  log "Inscription $name : création"
  az ad app create --display-name "$name" --sign-in-audience AzureADMyOrg --query appId -o tsv
}

# Principal de service de l'inscription : renvoie son objectId.
ensure_sp() {
  local app_id="$1" sp
  sp="$(az ad sp list --filter "appId eq '${app_id}'" --query "[].id | join('', @)" -o tsv)"
  if [[ -z "$sp" ]]; then
    log "Principal de service de $app_id : création"
    sp="$(az ad sp create --id "$app_id" --query id -o tsv)"
  fi
  printf '%s' "$sp"
}

# Credential fédéré GitHub : crée ou corrige le sujet. Pas de secret, un sujet exact (pas de joker).
ensure_fic() {
  local app_id="$1" name="$2" subject="$3" current body
  # printf -v : pas de substitution de commande autour de ce JSON (l'analyseur de bash 3.2, celui de macOS, s'y perd).
  printf -v body '{"name":"%s","issuer":"%s","subject":"%s","audiences":["api://AzureADTokenExchange"]}' \
    "$name" "$ISSUER" "$subject"
  current="$(az ad app federated-credential list --id "$app_id" --query "[?name=='${name}'].subject | join('', @)" -o tsv)"
  if [[ -z "$current" ]]; then
    log "Credential fédéré $name ($subject) : création"
    az ad app federated-credential create --id "$app_id" --parameters "$body" -o none
  elif [[ "$current" != "$subject" ]]; then
    log "Credential fédéré $name : sujet corrigé ($current vers $subject)"
    az ad app federated-credential update --id "$app_id" --federated-credential-id "$name" --parameters "$body" -o none
  else
    log "Credential fédéré $name : à jour"
  fi
}

ensure_role() {
  local sp="$1" role="$2" scope="$3" count
  count="$(az role assignment list --assignee "$sp" --scope "$scope" \
    --query "[?roleDefinitionName=='${role}'] | length(@)" -o tsv)"
  if [[ "$count" == "0" ]]; then
    log "Rôle $role sur $scope : attribution"
    az role assignment create --assignee-object-id "$sp" --assignee-principal-type ServicePrincipal \
      --role "$role" --scope "$scope" -o none
  else
    log "Rôle $role sur $scope : déjà attribué"
  fi
}

# Permission Graph (application) : équivaut au consentement administrateur.
ensure_graph_role() {
  local sp="$1" role="$2" graph_sp role_id count
  graph_sp="$(az ad sp show --id "$GRAPH_APP_ID" --query id -o tsv)"
  role_id="$(az ad sp show --id "$GRAPH_APP_ID" \
    --query "appRoles[?value=='${role}' && contains(allowedMemberTypes, 'Application')].id | join('', @)" -o tsv)"
  if [[ -z "$role_id" ]]; then
    echo "Rôle Graph $role introuvable." >&2
    exit 1
  fi
  count="$(az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/${sp}/appRoleAssignments" \
    --query "value[?appRoleId=='${role_id}'] | length(@)" -o tsv)"
  if [[ "$count" == "0" ]]; then
    log "Permission Graph $role : consentement"
    az rest --method POST \
      --url "https://graph.microsoft.com/v1.0/servicePrincipals/${graph_sp}/appRoleAssignedTo" \
      --body "{\"principalId\":\"${sp}\",\"resourceId\":\"${graph_sp}\",\"appRoleId\":\"${role_id}\"}" -o none
  else
    log "Permission Graph $role : déjà consentie"
  fi
}

grant_graph() {
  local sp="$1" name="$2"
  shift 2
  if [[ "$GRAPH_CONSENT" == "true" ]]; then
    local role
    for role in "$@"; do ensure_graph_role "$sp" "$role"; done
  else
    log "Permissions Graph de $name non consenties (GRAPH_CONSENT=true pour les attribuer) : $*"
  fi
}

# Identité de plan (lecture seule, tous environnements) ; rôles ajoutés pour l'abonnement courant.
plan_app_id="$(ensure_app "$PLAN_APP")"
plan_sp="$(ensure_sp "$plan_app_id")"
ensure_fic "$plan_app_id" "github-pull-request" "repo:${GITHUB_REPO}:pull_request"
ensure_role "$plan_sp" "Reader" "$sub_scope"
ensure_role "$plan_sp" "Storage Blob Data Reader" "$state_scope"
grant_graph "$plan_sp" "$PLAN_APP" "${PLAN_GRAPH_ROLES[@]}"

# Identité d'apply de l'environnement.
apply_app_id="$(ensure_app "$APPLY_APP")"
apply_sp="$(ensure_sp "$apply_app_id")"
ensure_fic "$apply_app_id" "github-environment-${ENVIRONMENT}" "repo:${GITHUB_REPO}:environment:${ENVIRONMENT}"
ensure_role "$apply_sp" "Contributor" "$sub_scope"
ensure_role "$apply_sp" "Storage Blob Data Contributor" "$state_scope"
grant_graph "$apply_sp" "$APPLY_APP" "${APPLY_GRAPH_ROLES[@]}"

upper="$(printf '%s' "$ENVIRONMENT" | tr '[:lower:]' '[:upper:]')"
cat <<EOF

Identités prêtes. Variables GitHub à poser (identifiants, pas des secrets) :

gh variable set AZURE_TENANT_ID --repo ${GITHUB_REPO} --body ${AZURE_TENANT_ID}
gh variable set AZURE_CLIENT_ID_PLAN --repo ${GITHUB_REPO} --body ${plan_app_id}
gh variable set AZURE_SUBSCRIPTION_ID_${upper} --repo ${GITHUB_REPO} --body ${AZURE_SUBSCRIPTION_ID}

# Environnement ${ENVIRONMENT} : déploiement limité à la branche main, puis variables.
gh api -X PUT repos/${GITHUB_REPO}/environments/${ENVIRONMENT} --input - <<< '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/${GITHUB_REPO}/environments/${ENVIRONMENT}/deployment-branch-policies -f name=main -f type=branch
gh variable set AZURE_CLIENT_ID --repo ${GITHUB_REPO} --env ${ENVIRONMENT} --body ${apply_app_id}
gh variable set AZURE_SUBSCRIPTION_ID --repo ${GITHUB_REPO} --env ${ENVIRONMENT} --body ${AZURE_SUBSCRIPTION_ID}
EOF
if [[ "$ENVIRONMENT" == "prod" ]]; then
  echo "# prod : activer aussi « Required reviewers » dans Settings > Environments > prod."
fi
if [[ "$GRAPH_CONSENT" != "true" ]]; then
  echo
  echo "Permissions Graph à consentir (administrateur) : relancer avec GRAPH_CONSENT=true."
fi
