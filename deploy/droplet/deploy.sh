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
REPO_URL="${REPO_URL:-$(git -C "${REPO_ROOT}" remote get-url origin)}"
DEPLOY_REF="${DEPLOY_REF:-main}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-${REPO_ROOT}/.env.prod}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${APP_DIR}/.env}"
REMOTE_ENV_DIR="$(dirname "${REMOTE_ENV_FILE}")"

if [[ ! -f "${LOCAL_ENV_FILE}" ]]; then
  echo "Local env file not found: ${LOCAL_ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${PAI_WEBDAV_URL:-}" || -z "${PAI_WEBDAV_USERNAME:-}" || -z "${PAI_WEBDAV_PASSWORD:-}" ]]; then
  echo "PAI_WEBDAV_URL / PAI_WEBDAV_USERNAME / PAI_WEBDAV_PASSWORD are required." >&2
  exit 1
fi

ssh "${DEPLOY_TARGET}" \
  "export APP_DIR='${APP_DIR}' REPO_URL='${REPO_URL}' DEPLOY_REF='${DEPLOY_REF}'; bash -lc '
    set -euo pipefail
    if [[ ! -d \"${APP_DIR}/.git\" ]]; then
      rm -rf \"${APP_DIR}\"
      git clone \"${REPO_URL}\" \"${APP_DIR}\"
    fi
    cd \"${APP_DIR}\"
    git remote set-url origin \"${REPO_URL}\"
    git fetch --prune --tags origin
    git reset --hard
    git clean -fd
    if git show-ref --verify --quiet \"refs/remotes/origin/${DEPLOY_REF}\"; then
      git checkout -B \"${DEPLOY_REF}\" \"origin/${DEPLOY_REF}\"
      git reset --hard \"origin/${DEPLOY_REF}\"
    else
      git checkout --force \"${DEPLOY_REF}\"
    fi
  '"

ssh "${DEPLOY_TARGET}" "mkdir -p '${APP_DIR}' '${REMOTE_ENV_DIR}'"
scp "${LOCAL_ENV_FILE}" "${DEPLOY_TARGET}:${REMOTE_ENV_FILE}"

ssh "${DEPLOY_TARGET}" \
  "export APP_DIR='${APP_DIR}' REMOTE_ENV_FILE='${REMOTE_ENV_FILE}' PAI_WEBDAV_URL='${PAI_WEBDAV_URL}' PAI_WEBDAV_USERNAME='${PAI_WEBDAV_USERNAME}' PAI_WEBDAV_PASSWORD='${PAI_WEBDAV_PASSWORD}' PAI_WEBDAV_MOUNT_POINT='${PAI_WEBDAV_MOUNT_POINT:-/mnt/pai-projects}' HOST_HTTP_PORT='${HOST_HTTP_PORT:-8091}'; bash -lc '
    set -euo pipefail
    bash \"${APP_DIR}/deploy/droplet/install-host.sh\"
  '"
