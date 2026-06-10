#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${SCRIPT_DIR}/droplet.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/droplet.env"
fi

DEPLOY_HOST="${DEPLOY_HOST:-68.183.235.149}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
APP_DIR="${APP_DIR:-/opt/comfyui-worker}"
REMOTE_TMP_ARCHIVE="${REMOTE_TMP_ARCHIVE:-/tmp/comfyui-worker-deploy.tgz}"
LOCAL_TMP_ARCHIVE="$(mktemp /tmp/comfyui-worker-deploy.XXXXXX.tgz)"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${REPO_ROOT}/.env}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${APP_DIR}/deploy/droplet/.env.production}"

cleanup() {
  rm -f "${LOCAL_TMP_ARCHIVE}"
}
trap cleanup EXIT

if [[ ! -f "${LOCAL_ENV_FILE}" ]]; then
  echo "Local env file not found: ${LOCAL_ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${PAI_WEBDAV_URL:-}" || -z "${PAI_WEBDAV_USERNAME:-}" || -z "${PAI_WEBDAV_PASSWORD:-}" ]]; then
  echo "PAI_WEBDAV_URL / PAI_WEBDAV_USERNAME / PAI_WEBDAV_PASSWORD are required." >&2
  exit 1
fi

tar \
  --exclude=".git" \
  --exclude="node_modules" \
  --exclude="dist" \
  --exclude=".tmp" \
  --exclude=".env" \
  -czf "${LOCAL_TMP_ARCHIVE}" \
  -C "${REPO_ROOT}" .

ssh "${DEPLOY_TARGET}" "mkdir -p '${APP_DIR}' '${APP_DIR}/deploy/droplet'"
scp "${LOCAL_TMP_ARCHIVE}" "${DEPLOY_TARGET}:${REMOTE_TMP_ARCHIVE}"
scp "${LOCAL_ENV_FILE}" "${DEPLOY_TARGET}:${REMOTE_ENV_FILE}"

ssh "${DEPLOY_TARGET}" \
  "export APP_DIR='${APP_DIR}' REMOTE_ENV_FILE='${REMOTE_ENV_FILE}' PAI_WEBDAV_URL='${PAI_WEBDAV_URL}' PAI_WEBDAV_USERNAME='${PAI_WEBDAV_USERNAME}' PAI_WEBDAV_PASSWORD='${PAI_WEBDAV_PASSWORD}' PAI_WEBDAV_MOUNT_POINT='${PAI_WEBDAV_MOUNT_POINT:-/mnt/pai-projects}' HOST_HTTP_PORT='${HOST_HTTP_PORT:-8091}' REMOTE_TMP_ARCHIVE='${REMOTE_TMP_ARCHIVE}'; bash -lc '
    set -euo pipefail
    mkdir -p \"${APP_DIR}\"
    tar -xzf \"${REMOTE_TMP_ARCHIVE}\" -C \"${APP_DIR}\"
    rm -f \"${REMOTE_TMP_ARCHIVE}\"
    chmod +x \"${APP_DIR}/deploy/droplet/install-host.sh\"
    \"${APP_DIR}/deploy/droplet/install-host.sh\"
  '"
