#!/usr/bin/env bash
# Affectations de rôles d'application d'un environnement, posées par un administrateur (pas par la CI) :
#   - permissions Graph (application) de l'identité managée de la Web App (GRAPH_APP_ROLES ci-dessous) ;
#   - rôles RH et Direction de l'application, d'après rh_principal_object_ids et direction_principal_object_ids
#     de infra/envs/<env>.tfvars ;
#   - unité administrative à gestion restreinte des comptes d'onboarding (audit M8) : création, rôle User Administrator de
#     l'identité managée limité à l'unité. L'objectId de l'unité est à reporter dans onboarding_unit_id (tfvars), puis
#     terraform apply.
#
# MIGRER=true (une seule fois, à la mise en place de l'unité) : ajoute aussi à l'unité les demandes en cours créées avant
# elle (EnAttente, Validé, Actif). À ne jamais laisser actif ensuite : un administrateur d'utilisateurs peut poser un statut
# sur n'importe quel compte, et ce script le ferait entrer dans l'unité (l'application l'accepterait alors comme demande).
# Garde-fous : un compte EnAttente ou Validé déjà activé (l'application ne crée que des comptes désactivés) ou qui porte un
# rôle d'annuaire est écarté et signalé. Sans APPLY=true, la liste des candidats est affichée pour relecture.
# Terraform ne les gère plus : affecter un rôle d'application exige AppRoleAssignment.ReadWrite.All, qui permettrait à
# l'identité d'apply de la CI de s'accorder n'importe quel droit Graph (tier 0). Voir README, « Prérequis ».
#
# À lancer après le premier apply d'un environnement (l'identité managée et l'inscription doivent exister), puis après
# tout changement de ces listes ou de GRAPH_APP_ROLES. Idempotent : n'ajoute que ce qui manque, ne retire rien ; les
# affectations en trop sont signalées, à retirer à la main.
# Sans APPLY=true, le script n'écrit rien : il affiche ce qu'il ferait.
#
# Prérequis : az login, avec Privileged Role Administrator ou Global Administrator (permissions Graph de l'identité
# managée, unité à gestion restreinte et rôle limité à l'unité) ; Reader sur le groupe de ressources de l'environnement.
#
# Usage :
#   ENVIRONMENT=dev AZURE_TENANT_ID=<tenant> AZURE_SUBSCRIPTION_ID=<abonnement> scripts/grant-app-roles.sh
#   APPLY=true ENVIRONMENT=dev AZURE_TENANT_ID=<tenant> AZURE_SUBSCRIPTION_ID=<abonnement> scripts/grant-app-roles.sh
#
# Variable facultative : NAME_SUFFIX (name_suffix de Terraform, vide par défaut).
set -euo pipefail

: "${ENVIRONMENT:?Renseigner ENVIRONMENT (dev, test ou prod)}"
: "${AZURE_TENANT_ID:?Renseigner AZURE_TENANT_ID (tenant attendu)}"
: "${AZURE_SUBSCRIPTION_ID:?Renseigner AZURE_SUBSCRIPTION_ID (abonnement attendu)}"

case "$ENVIRONMENT" in
  dev | test | prod) ;;
  *) echo "ENVIRONMENT doit valoir dev, test ou prod." >&2; exit 1 ;;
esac

APPLY="${APPLY:-false}"
NAME="telesio-onboarding-${ENVIRONMENT}${NAME_SUFFIX:-}"
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"

# Permissions Graph (application) de l'identité managée.
GRAPH_APP_ROLES=(
  User.ReadWrite.All                       # créer le compte (et le supprimer si l'ajout à l'unité échoue) ; dans l'unité à gestion
                                           # restreinte, ce droit ne s'applique plus : c'est le rôle limité à l'unité qui écrit
  User.Read.All                            # manager, disponibilité de l'UPN
  AuditLog.Read.All                        # journaux de provisionnement : statut Salesforce sur la page de détail
  GroupMember.ReadWrite.All                # ajouter/retirer un compte du groupe de licence ; inclut checkMemberGroups
  LicenseAssignment.Read.All               # GET /subscribedSkus : licences disponibles
  User-PasswordProfile.ReadWrite.All       # mot de passe temporaire le jour J (changement imposé à la 1re connexion)
  UserAuthMethod-MicrosoftAuthApp.Read.All # onboarding Terminé : Authenticator inscrit
  Sites.Selected                           # un seul site, via le grant SharePoint (graph.tf)
  AdministrativeUnit.ReadWrite.All         # ajouter le compte créé à l'unité des comptes d'onboarding, l'en retirer à Terminé
)
# Rôle Entra « User Administrator » (modèle fixe), affecté à l'identité managée sur l'unité seulement : seul droit d'écriture
# sur les comptes de l'unité (statut, compte, mot de passe, suppression). Il ne peut rien sur un compte hors de l'unité.
USER_ADMIN_ROLE="fe930be7-5e62-47db-91af-98c3a49a38b1"

log() { printf '> %s\n' "$*" >&2; }

current_tenant="$(az account show --query tenantId -o tsv)"
current_sub="$(az account show --query id -o tsv)"
if [[ "$current_tenant" != "$AZURE_TENANT_ID" || "$current_sub" != "$AZURE_SUBSCRIPTION_ID" ]]; then
  echo "Contexte az inattendu (tenant $current_tenant, abonnement $current_sub). Abandon." >&2
  exit 1
fi

tfvars="$(cd "$(dirname "$0")/.." && pwd)/infra/envs/${ENVIRONMENT}.tfvars"
# Liste d'objectIds d'une variable des tfvars (une ligne `nom = ["…", "…"]`), un par ligne.
tfvars_ids() {
  grep -E "^${1}[[:space:]]*=" "$tfvars" | grep -oE '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}' || true
}

mi_principal="$(az identity show -g "rg-${NAME}" -n "id-${NAME}" --query principalId -o tsv)"
web_app_id="$(az ad app list --display-name "app-${NAME}" --query "[?displayName=='app-${NAME}'].appId | join('', @)" -o tsv)"
if [[ -z "$mi_principal" || -z "$web_app_id" ]]; then
  echo "Identité managée id-${NAME} ou inscription app-${NAME} introuvable : appliquer Terraform d'abord." >&2
  exit 1
fi
web_sp="$(az ad sp show --id "$web_app_id" --query id -o tsv)"
graph_sp="$(az ad sp show --id "$GRAPH_APP_ID" --query id -o tsv)"

MISSING=0
# Affecte le rôle role_id de la ressource resource_sp au principal, s'il ne l'a pas.
ensure_assignment() {
  local resource_sp="$1" role_id="$2" principal="$3" label="$4" count
  count="$(az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/${resource_sp}/appRoleAssignedTo?\$top=999" \
    --query "value[?principalId=='${principal}' && appRoleId=='${role_id}'] | length(@)" -o tsv)"
  if [[ "$count" != "0" ]]; then
    log "$label : déjà affecté"
  elif [[ "$APPLY" == "true" ]]; then
    log "$label : affectation"
    az rest --method POST \
      --url "https://graph.microsoft.com/v1.0/servicePrincipals/${resource_sp}/appRoleAssignedTo" \
      --body "{\"principalId\":\"${principal}\",\"resourceId\":\"${resource_sp}\",\"appRoleId\":\"${role_id}\"}" -o none
  else
    log "$label : MANQUANT (APPLY=true pour l'affecter)"
    MISSING=$((MISSING + 1))
  fi
}

# Signale les affectations d'un principal (ou d'un rôle) qui ne sont pas dans la liste attendue.
report_extra() {
  local label="$1" query="$2" resource_sp="$3" extra
  extra="$(az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/${resource_sp}/appRoleAssignedTo?\$top=999" \
    --query "$query" -o tsv)"
  if [[ -n "$extra" ]]; then
    log "$label : affectations hors liste, à retirer à la main si besoin : $(printf '%s' "$extra" | tr '\n' ' ')"
  fi
}

# Permissions Graph de l'identité managée.
expected_graph_ids=()
for role in "${GRAPH_APP_ROLES[@]}"; do
  role_id="$(az ad sp show --id "$GRAPH_APP_ID" \
    --query "appRoles[?value=='${role}' && contains(allowedMemberTypes, 'Application')].id | join('', @)" -o tsv)"
  if [[ -z "$role_id" ]]; then
    echo "Rôle Graph $role introuvable." >&2
    exit 1
  fi
  expected_graph_ids+=("$role_id")
  ensure_assignment "$graph_sp" "$role_id" "$mi_principal" "Graph $role pour id-${NAME}"
done
graph_filter="$(printf "appRoleId!='%s' && " "${expected_graph_ids[@]}")"
report_extra "Graph, id-${NAME}" "value[?principalId=='${mi_principal}' && ${graph_filter% && }].appRoleId" "$graph_sp"

# Rôles RH et Direction (valeur du rôle : rh_role et direction_role de Terraform, RH et Direction par défaut).
for pair in "RH:rh_principal_object_ids" "Direction:direction_principal_object_ids"; do
  value="${pair%%:*}"
  var="${pair#*:}"
  role_id="$(az ad sp show --id "$web_app_id" --query "appRoles[?value=='${value}'].id | join('', @)" -o tsv)"
  if [[ -z "$role_id" ]]; then
    echo "Rôle $value introuvable sur app-${NAME}." >&2
    exit 1
  fi
  ids=()
  while IFS= read -r id; do
    [[ -n "$id" ]] && ids+=("$id")
  done < <(tfvars_ids "$var")
  filter=""
  for id in ${ids[@]+"${ids[@]}"}; do
    ensure_assignment "$web_sp" "$role_id" "$id" "Rôle $value pour $id"
    filter+=" && principalId!='${id}'"
  done
  report_extra "Rôle $value" "value[?appRoleId=='${role_id}'${filter}].principalId" "$web_sp"
done

# Unité administrative à gestion restreinte (le réglage ne peut être posé qu'à la création). Retrouvée par son nom.
unit_name="Onboarding ${NAME}"
unit_id="$(az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/directory/administrativeUnits?\$filter=displayName eq '${unit_name}'&\$select=id,isMemberManagementRestricted" \
  --query "value[0].id" -o tsv)"
if [[ -z "$unit_id" ]]; then
  if [[ "$APPLY" == "true" ]]; then
    log "Unité « ${unit_name} » : création (gestion restreinte)"
    unit_id="$(az rest --method POST --url "https://graph.microsoft.com/v1.0/directory/administrativeUnits" \
      --body "{\"displayName\":\"${unit_name}\",\"description\":\"Comptes d'onboarding de app-${NAME} : modifiables par l'application seulement.\",\"isMemberManagementRestricted\":true}" \
      --query id -o tsv)"
  else
    log "Unité « ${unit_name} » : MANQUANTE (APPLY=true pour la créer)"
    MISSING=$((MISSING + 1))
  fi
else
  restricted="$(az rest --method GET --url "https://graph.microsoft.com/v1.0/directory/administrativeUnits/${unit_id}?\$select=isMemberManagementRestricted" --query isMemberManagementRestricted -o tsv)"
  if [[ "$restricted" != "true" ]]; then
    echo "L'unité « ${unit_name} » existe sans gestion restreinte (réglage fixé à la création) : la supprimer, puis relancer." >&2
    exit 1
  fi
  log "Unité « ${unit_name} » : déjà créée"
fi

if [[ -n "$unit_id" ]]; then
  scope="/administrativeUnits/${unit_id}"
  count="$(az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments?\$filter=principalId eq '${mi_principal}' and roleDefinitionId eq '${USER_ADMIN_ROLE}'" \
    --query "value[?directoryScopeId=='${scope}'] | length(@)" -o tsv)"
  if [[ "$count" != "0" ]]; then
    log "User Administrator sur l'unité pour id-${NAME} : déjà affecté"
  elif [[ "$APPLY" == "true" ]]; then
    log "User Administrator sur l'unité pour id-${NAME} : affectation"
    az rest --method POST --url "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments" \
      --body "{\"principalId\":\"${mi_principal}\",\"roleDefinitionId\":\"${USER_ADMIN_ROLE}\",\"directoryScopeId\":\"${scope}\"}" -o none
  else
    log "User Administrator sur l'unité pour id-${NAME} : MANQUANT (APPLY=true pour l'affecter)"
    MISSING=$((MISSING + 1))
  fi

  # Demandes en cours créées avant l'unité (MIGRER=true seulement) : sans elles dans l'unité, l'application les refuse (404).
  [[ "${MIGRER:-false}" == "true" ]] && migrer=true || migrer=false
  if [[ "$migrer" == "true" ]]; then
    status_ext="$(az webapp config appsettings list -g "rg-${NAME}" -n "app-${NAME}" \
      --query "[?name=='ENTRA_STATUS_EXTENSION'].value | [0]" -o tsv)"
    if [[ -z "$status_ext" ]]; then
      echo "ENTRA_STATUS_EXTENSION introuvable sur app-${NAME} : appliquer Terraform d'abord." >&2
      exit 1
    fi
    members="$(az rest --method GET --url "https://graph.microsoft.com/v1.0/directory/administrativeUnits/${unit_id}/members?\$select=id&\$top=999" \
      --query "value[].id" -o tsv)"
    for statut in EnAttente Validé Actif; do
      while IFS=$'\t' read -r uid enabled; do
        [[ -z "$uid" ]] && continue
        if grep -qx "$uid" <<<"$members"; then continue; fi
        if [[ "$statut" != "Actif" && "$enabled" == "true" ]]; then
          log "Demande $uid ($statut) : ÉCARTÉE, compte déjà activé (l'application ne crée que des comptes désactivés)"
          continue
        fi
        roles="$(az rest --method GET \
          --url "https://graph.microsoft.com/v1.0/users/${uid}/transitiveMemberOf/microsoft.graph.directoryRole?\$select=id" \
          --query "length(value)" -o tsv)"
        if [[ "$roles" != "0" ]]; then
          log "Demande $uid ($statut) : ÉCARTÉE, le compte porte un rôle d'annuaire (statut posé à la main ?)"
          continue
        fi
        if [[ "$APPLY" == "true" ]]; then
          log "Demande $uid ($statut) : ajout à l'unité"
          az rest --method POST --url "https://graph.microsoft.com/v1.0/directory/administrativeUnits/${unit_id}/members/\$ref" \
            --body "{\"@odata.id\":\"https://graph.microsoft.com/v1.0/directoryObjects/${uid}\"}" -o none
        else
          log "Demande $uid ($statut) : candidate, à ajouter à l'unité (relire, puis APPLY=true MIGRER=true)"
          MISSING=$((MISSING + 1))
        fi
      done < <(az rest --method GET --headers "ConsistencyLevel=eventual" \
        --url "https://graph.microsoft.com/v1.0/users?\$filter=${status_ext} eq '${statut}'&\$select=id,accountEnabled&\$count=true&\$top=999" \
        --query "value[].[id, to_string(accountEnabled)]" -o tsv)
    done
  fi

  echo
  echo "Unité des comptes d'onboarding : ${unit_id}"
  echo "À reporter dans infra/envs/${ENVIRONMENT}.tfvars : onboarding_unit_id = \"${unit_id}\", puis terraform apply."
fi

if [[ "$MISSING" -gt 0 ]]; then
  echo
  echo "$MISSING affectation(s) manquante(s) : relancer avec APPLY=true (administrateur)."
fi
