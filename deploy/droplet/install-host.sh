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
SUPERVISOR_SERVICE_NAME="supervisor.service"
SERVER_SERVICE_NAME="comfyui-worker-server.service"
CONSUMER_SERVICE_NAME="comfyui-worker-consumer.service"
SUPERVISOR_CONFIG_TEMPLATE="${APP_DIR}/deploy/droplet/comfyui-worker.supervisor.conf"
SUPERVISOR_CONFIG_PATH="/etc/supervisor/conf.d/comfyui-worker.conf"
SUPERVISOR_OVERRIDE_DIR="/etc/systemd/system/${SUPERVISOR_SERVICE_NAME}.d"
SUPERVISOR_OVERRIDE_FILE="${SUPERVISOR_OVERRIDE_DIR}/override.conf"
FSTAB_WEBDAV_LINE="${WEBDAV_URL} ${WEBDAV_MOUNT_POINT} davfs _netdev,nofail,uid=0,gid=0,dir_mode=0775,file_mode=0664 0 0"
FSTAB_BIND_LINE="${WEBDAV_MOUNT_POINT} ${DATA_PROJECTS_ROOT} none bind,nofail 0 0"

export DEBIAN_FRONTEND=noninteractive

apt_updated=false

apt_update_once() {
  if [[ "${apt_updated}" != "true" ]]; then
    apt-get update
    apt_updated=true
  fi
}

ensure_apt_packages() {
  local missing=()
  local pkg
  for pkg in "$@"; do
    if ! dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null | grep -Fq 'install ok installed'; then
      missing+=("${pkg}")
    fi
  done

  if ((${#missing[@]} > 0)); then
    apt_update_once
    apt-get install -y --no-install-recommends "${missing[@]}"
  fi
}

escape_regex() {
  printf '%s' "$1" | sed 's/[][(){}.^$*+?|\\/]/\\&/g'
}

ensure_apt_packages \
  ca-certificates \
  curl \
  davfs2 \
  git \
  gnupg \
  supervisor

mkdir -p /etc/apt/keyrings
if [[ ! -f "${NODESOURCE_KEYRING}" ]]; then
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o "${NODESOURCE_KEYRING}"
fi

nodesource_repo_line="deb [signed-by=${NODESOURCE_KEYRING}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main"
if [[ ! -f "${NODESOURCE_LIST}" ]] || ! grep -Fqx "${nodesource_repo_line}" "${NODESOURCE_LIST}"; then
cat > "${NODESOURCE_LIST}" <<EOF
deb [signed-by=${NODESOURCE_KEYRING}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main
EOF
fi

ensure_nodejs() {
  if command -v node >/dev/null 2>&1; then
    local current_major
    current_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
    if [[ "${current_major}" == "${NODE_MAJOR}" ]]; then
      return
    fi
  fi

  apt_update_once
  apt-get install -y --no-install-recommends nodejs
}

ensure_nodejs

mkdir -p "${WEBDAV_MOUNT_POINT}" "${DATA_PROJECTS_ROOT}" /var/cache/pai /var/tmp/pai /var/log/pai
mkdir -p "$(dirname "${REMOTE_ENV_FILE}")"

touch "${DAVFS_SECRETS_FILE}"
chmod 600 "${DAVFS_SECRETS_FILE}"
escaped_webdav_url="$(escape_regex "${WEBDAV_URL}")"
if grep -Eq "^[[:space:]]*${escaped_webdav_url}[[:space:]]+" "${DAVFS_SECRETS_FILE}"; then
  sed -i "\|^[[:space:]]*${escaped_webdav_url}[[:space:]].*$|d" "${DAVFS_SECRETS_FILE}"
fi
printf '%s %s %s\n' "${WEBDAV_URL}" "${WEBDAV_USERNAME}" "${WEBDAV_PASSWORD}" >> "${DAVFS_SECRETS_FILE}"

if ! grep -Eq '^[[:space:]]*use_locks[[:space:]]+0([[:space:]]|$)' "${DAVFS_CONF_FILE}"; then
  printf '\nuse_locks 0\n' >> "${DAVFS_CONF_FILE}"
fi

upsert_fstab_line() {
  local match_regex="$1"
  local line="$2"
  if grep -Eq "${match_regex}" /etc/fstab; then
    sed -i "\|${match_regex}|c\\${line}" /etc/fstab
  else
    printf '%s\n' "${line}" >> /etc/fstab
  fi
}

escaped_webdav_mount_point="$(escape_regex "${WEBDAV_MOUNT_POINT}")"
escaped_data_projects_root="$(escape_regex "${DATA_PROJECTS_ROOT}")"
upsert_fstab_line "^[[:space:]]*[^#]+[[:space:]]+${escaped_webdav_mount_point}[[:space:]]+davfs[[:space:]]+" "${FSTAB_WEBDAV_LINE}"
upsert_fstab_line "^[[:space:]]*[^#]+[[:space:]]+${escaped_data_projects_root}[[:space:]]+none[[:space:]]+bind" "${FSTAB_BIND_LINE}"

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

sed \
  -e "s|@APP_DIR@|${APP_DIR}|g" \
  "${SUPERVISOR_CONFIG_TEMPLATE}" > "${SUPERVISOR_CONFIG_PATH}"

mkdir -p "${SUPERVISOR_OVERRIDE_DIR}"
cat > "${SUPERVISOR_OVERRIDE_FILE}" <<EOF
[Unit]
After=remote-fs.target network-online.target
Wants=network-online.target
RequiresMountsFor=${DATA_PROJECTS_ROOT}
EOF

systemctl disable --now "${SERVER_SERVICE_NAME}" "${CONSUMER_SERVICE_NAME}" >/dev/null 2>&1 || true
rm -f "/etc/systemd/system/${SERVER_SERVICE_NAME}" "/etc/systemd/system/${CONSUMER_SERVICE_NAME}"
systemctl daemon-reload

systemctl enable --now "${SUPERVISOR_SERVICE_NAME}"
supervisorctl reread
supervisorctl update
supervisorctl restart comfyui-worker-server comfyui-worker-consumer
supervisorctl status
systemctl --no-pager --full status "${SUPERVISOR_SERVICE_NAME}" || true
