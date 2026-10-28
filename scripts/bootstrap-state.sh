#!/usr/bin/env bash
# Bootstrap de l'état Terraform : groupe de ressources, compte de stockage SANS clés partagées,
# conteneur tfstate, rôle « Storage Blob Data Contributor » pour l'utilisateur connecté.
# Idempotent : on peut le relancer sans effet si tout existe déjà.
#
# Prérequis : az login, rôle Owner (ou User Access Administrator) sur l'abonnement.
#
# Usage :
#   AZURE_TENANT_ID=<tenant> AZURE_SUBSCRIPTION_ID=<abonnement> scripts/bootstrap-state.sh
#
# Variables facultatives : LOCATION (francecentral), RESOURCE_GROUP (rg-telesio-tfstate),
# STORAGE_ACCOUNT (nom dérivé de l'abonnement), CONTAINER (tfstate).
set -euo pipefail

: "${AZURE_TENANT_ID:?Renseigner AZURE_TENANT_ID (tenant attendu)}"
: "${AZURE_SUBSCRIPTION_ID:?Renseigner AZURE_SUBSCRIPTION_ID (abonnement attendu)}"

LOCATION="${LOCATION:-francecentral}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-telesio-tfstate}"
CONTAINER="${CONTAINER:-tfstate}"

log() { printf '> %s\n' "$*"; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi
}

# Garde-fou : aucune écriture avant d'avoir vérifié le contexte Azure.
current_tenant="$(az account show --query tenantId -o tsv)"
current_sub="$(az account show --query id -o tsv)"
if [[ "$current_tenant" != "$AZURE_TENANT_ID" || "$current_sub" != "$AZURE_SUBSCRIPTION_ID" ]]; then
  echo "Contexte az inattendu (tenant $current_tenant, abonnement $current_sub). Abandon." >&2
  exit 1
fi

# Nom de compte : global à Azure, donc dérivé de l'abonnement (stable d'un lancement à l'autre).
suffix="$(printf '%s' "$AZURE_SUBSCRIPTION_ID" | sha256 | cut -c1-6)"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-sttelesiotfstate${suffix}}"

log "Fournisseur Microsoft.Storage"
state="$(az provider show -n Microsoft.Storage --query registrationState -o tsv)"
if [[ "$state" != "Registered" ]]; then
  az provider register -n Microsoft.Storage --wait
fi

log "Groupe de ressources $RESOURCE_GROUP ($LOCATION)"
if [[ "$(az group exists -n "$RESOURCE_GROUP")" != "true" ]]; then
  az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none
fi

log "Compte de stockage $STORAGE_ACCOUNT"
if ! az storage account show -g "$RESOURCE_GROUP" -n "$STORAGE_ACCOUNT" -o none 2>/dev/null; then
  available="$(az storage account check-name -n "$STORAGE_ACCOUNT" --query nameAvailable -o tsv)"
  if [[ "$available" != "true" ]]; then
    echo "Le nom $STORAGE_ACCOUNT est indisponible. Relancer avec STORAGE_ACCOUNT=<autre nom>." >&2
    exit 1
  fi
  az storage account create -g "$RESOURCE_GROUP" -n "$STORAGE_ACCOUNT" -l "$LOCATION" \
    --sku Standard_LRS --kind StorageV2 \
    --allow-shared-key-access false \
    --allow-blob-public-access false \
    --min-tls-version TLS1_2 \
    --https-only true \
    --default-action Allow \
    --tags purpose=tfstate -o none
fi

# Rejoue à chaque lancement : ramène un compte existant à la configuration attendue.
az storage account update -g "$RESOURCE_GROUP" -n "$STORAGE_ACCOUNT" \
  --allow-shared-key-access false --allow-blob-public-access false \
  --min-tls-version TLS1_2 --https-only true -o none

log "Versions et suppression récupérable des blobs (30 jours)"
az storage account blob-service-properties update -g "$RESOURCE_GROUP" --account-name "$STORAGE_ACCOUNT" \
  --enable-versioning true --enable-delete-retention true --delete-retention-days 30 -o none

# Plan de contrôle (ARM) : le plan de données exigerait le rôle blob, pas encore propagé,
# et il n'y a aucun repli par clé puisque les clés partagées sont désactivées.
log "Conteneur $CONTAINER"
if ! az storage container-rm show --storage-account "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" -n "$CONTAINER" -o none 2>/dev/null; then
  az storage container-rm create --storage-account "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" -n "$CONTAINER" -o none
fi

log "Rôle Storage Blob Data Contributor pour l'utilisateur connecté"
me="$(az ad signed-in-user show --query id -o tsv)"
scope="$(az storage account show -g "$RESOURCE_GROUP" -n "$STORAGE_ACCOUNT" --query id -o tsv)"
existing="$(az role assignment list --assignee "$me" --scope "$scope" \
  --query "[?roleDefinitionName=='Storage Blob Data Contributor'] | length(@)" -o tsv)"
if [[ "$existing" == "0" ]]; then
  az role assignment create --assignee-object-id "$me" --assignee-principal-type User \
    --role "Storage Blob Data Contributor" --scope "$scope" -o none
  log "Rôle attribué (la propagation RBAC peut prendre quelques minutes avant terraform init)"
else
  log "Rôle déjà attribué"
fi

echo
echo "resource_group_name  = \"$RESOURCE_GROUP\""
echo "storage_account_name = \"$STORAGE_ACCOUNT\""
echo "container_name       = \"$CONTAINER\""
