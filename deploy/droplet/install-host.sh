#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/comfyui-worker}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${APP_DIR}/.env}"
WEBDAV_URL="${PAI_WEBDAV_URL:?PAI_WEBDAV_URL is required}"
WEBDAV_USERNAME="${PAI_WEBDAV_USERNAME:?PAI_WEBDAV_USERNAME is required}"
WEBDAV_PASSWORD="${PAI_WEBDAV_PASSWORD:?PAI_WEBDAV_PASSWORD is required}"
WEBDAV_MOUNT_POINT="${PAI_WEBDAV_MOUNT_POINT:-/mnt/pai-projects}"
DATA_PROJECTS_ROOT="${DATA_PROJECTS_ROOT:-/data/pai-projects}"
HOST_HTTP_PORT="${HOST_HTTP_PORT:-8091}"
NODE_MAJOR="${NODE_MAJOR:-22}"
DAVFS_SECRETS_FILE="/etc/davfs2/secrets"
DAVFS_CONF_FILE="/etc/davfs2/davfs2.conf"
NODESOURCE_KEYRING="/etc/apt/keyrings/nodesource.gpg"
NODESOURCE_LIST="/etc/apt/sources.list.d/nodesource.list"
SERVER_SERVICE_NAME="comfyui-worker-server.service"
CONSUMER_SERVICE_NAME="comfyui-worker-consumer.service"
SERVER_SERVICE_TEMPLATE="${APP_DIR}/deploy/droplet/comfyui-worker-server.service"
CONSUMER_SERVICE_TEMPLATE="${APP_DIR}/deploy/droplet/comfyui-worker-consumer.service"
FSTAB_WEBDAV_LINE="${WEBDAV_URL} ${WEBDAV_MOUNT_POINT} davfs _netdev,nofail,uid=0,gid=0,dir_mode=0775,file_mode=0664 0 0"
FSTAB_BIND_LINE="${WEBDAV_MOUNT_POINT} ${DATA_PROJECTS_ROOT} none bind,nofail 0 0"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  davfs2 \
  git \
  gnupg

mkdir -p /etc/apt/keyrings
if [[ ! -f "${NODESOURCE_KEYRING}" ]]; then
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o "${NODESOURCE_KEYRING}"
fi

cat > "${NODESOURCE_LIST}" <<EOF
deb [signed-by=${NODESOURCE_KEYRING}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main
EOF

apt-get update
apt-get install -y --no-install-recommends nodejs

mkdir -p "${WEBDAV_MOUNT_POINT}" "${DATA_PROJECTS_ROOT}" /var/cache/pai /var/tmp/pai /var/log/pai

touch "${DAVFS_SECRETS_FILE}"
chmod 600 "${DAVFS_SECRETS_FILE}"
if ! grep -Fq "${WEBDAV_URL} ${WEBDAV_USERNAME} ${WEBDAV_PASSWORD}" "${DAVFS_SECRETS_FILE}"; then
  printf '%s %s %s\n' "${WEBDAV_URL}" "${WEBDAV_USERNAME}" "${WEBDAV_PASSWORD}" >> "${DAVFS_SECRETS_FILE}"
fi

if ! grep -Eq '^[[:space:]]*use_locks[[:space:]]+0([[:space:]]|$)' "${DAVFS_CONF_FILE}"; then
  printf '\nuse_locks 0\n' >> "${DAVFS_CONF_FILE}"
fi

if ! grep -Fq "${WEBDAV_URL} ${WEBDAV_MOUNT_POINT} davfs" /etc/fstab; then
  printf '%s\n' "${FSTAB_WEBDAV_LINE}" >> /etc/fstab
fi

if ! grep -Fq "${WEBDAV_MOUNT_POINT} ${DATA_PROJECTS_ROOT} none bind" /etc/fstab; then
  printf '%s\n' "${FSTAB_BIND_LINE}" >> /etc/fstab
fi

if ! mountpoint -q "${WEBDAV_MOUNT_POINT}"; then
  mount "${WEBDAV_MOUNT_POINT}" || mount -a
fi

if ! mountpoint -q "${DATA_PROJECTS_ROOT}"; then
  mount "${DATA_PROJECTS_ROOT}" || mount -a
fi

mkdir -p "${DATA_PROJECTS_ROOT}/.pai-workers"

if [[ ! -f "${REMOTE_ENV_FILE}" ]]; then
  echo "Missing env file: ${REMOTE_ENV_FILE}" >&2
  exit 1
fi

upsert_env_value() {
  local key="$1"
  local value="$2"
  if grep -Eq "^[[:space:]]*${key}=" "${REMOTE_ENV_FILE}"; then
    sed -i "s|^[[:space:]]*${key}=.*$|${key}=${value}|" "${REMOTE_ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${REMOTE_ENV_FILE}"
  fi
}

upsert_env_value "COMFYUI_WORKER_PORT" "${HOST_HTTP_PORT}"
upsert_env_value "PAI_PROJECTS_MOUNT_ROOT" "${DATA_PROJECTS_ROOT}"
upsert_env_value "COMFYUI_WORKER_PROJECTS_ROOT" "${DATA_PROJECTS_ROOT}"
upsert_env_value "COMFYUI_WORKER_REGISTRY_ROOT" "${DATA_PROJECTS_ROOT}/.pai-workers"

if command -v docker >/dev/null 2>&1; then
  docker rm -f comfyui-worker >/dev/null 2>&1 || true
fi

cd "${APP_DIR}"
npm ci
npm run compile

install_systemd_service() {
  local template_path="$1"
  local target_path="$2"

  sed \
    -e "s|@APP_DIR@|${APP_DIR}|g" \
    -e "s|@ENV_FILE@|${REMOTE_ENV_FILE}|g" \
    -e "s|@DATA_PROJECTS_ROOT@|${DATA_PROJECTS_ROOT}|g" \
    "${template_path}" > "${target_path}"
}

install_systemd_service "${SERVER_SERVICE_TEMPLATE}" "/etc/systemd/system/${SERVER_SERVICE_NAME}"
install_systemd_service "${CONSUMER_SERVICE_TEMPLATE}" "/etc/systemd/system/${CONSUMER_SERVICE_NAME}"

systemctl daemon-reload
systemctl enable "${SERVER_SERVICE_NAME}" "${CONSUMER_SERVICE_NAME}"
systemctl restart "${SERVER_SERVICE_NAME}" "${CONSUMER_SERVICE_NAME}"
systemctl --no-pager --full status "${SERVER_SERVICE_NAME}" "${CONSUMER_SERVICE_NAME}" || true
