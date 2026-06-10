#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/comfyui-worker}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${APP_DIR}/deploy/droplet/.env.production}"
COMPOSE_FILE="${APP_DIR}/deploy/droplet/docker-compose.yml"
WEBDAV_URL="${PAI_WEBDAV_URL:?PAI_WEBDAV_URL is required}"
WEBDAV_USERNAME="${PAI_WEBDAV_USERNAME:?PAI_WEBDAV_USERNAME is required}"
WEBDAV_PASSWORD="${PAI_WEBDAV_PASSWORD:?PAI_WEBDAV_PASSWORD is required}"
WEBDAV_MOUNT_POINT="${PAI_WEBDAV_MOUNT_POINT:-/mnt/pai-projects}"
HOST_HTTP_PORT="${HOST_HTTP_PORT:-8091}"
DAVFS_SECRETS_FILE="/etc/davfs2/secrets"
DAVFS_CONF_FILE="/etc/davfs2/davfs2.conf"
FSTAB_LINE="${WEBDAV_URL} ${WEBDAV_MOUNT_POINT} davfs _netdev,nofail,uid=0,gid=0,dir_mode=0775,file_mode=0664 0 0"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  davfs2 \
  docker.io \
  docker-compose-plugin \
  git

systemctl enable --now docker

mkdir -p "${WEBDAV_MOUNT_POINT}" /var/cache/pai /var/tmp/pai /var/log/pai

touch "${DAVFS_SECRETS_FILE}"
chmod 600 "${DAVFS_SECRETS_FILE}"
if ! grep -Fq "${WEBDAV_URL} ${WEBDAV_USERNAME} ${WEBDAV_PASSWORD}" "${DAVFS_SECRETS_FILE}"; then
  printf '%s %s %s\n' "${WEBDAV_URL}" "${WEBDAV_USERNAME}" "${WEBDAV_PASSWORD}" >> "${DAVFS_SECRETS_FILE}"
fi

if ! grep -Eq '^[[:space:]]*use_locks[[:space:]]+0([[:space:]]|$)' "${DAVFS_CONF_FILE}"; then
  printf '\nuse_locks 0\n' >> "${DAVFS_CONF_FILE}"
fi

if ! grep -Fq "${WEBDAV_URL} ${WEBDAV_MOUNT_POINT} davfs" /etc/fstab; then
  printf '%s\n' "${FSTAB_LINE}" >> /etc/fstab
fi

if ! mountpoint -q "${WEBDAV_MOUNT_POINT}"; then
  mount "${WEBDAV_MOUNT_POINT}" || mount -a
fi

if [[ ! -f "${REMOTE_ENV_FILE}" ]]; then
  echo "Missing env file: ${REMOTE_ENV_FILE}" >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*COMFYUI_WORKER_PORT=' "${REMOTE_ENV_FILE}"; then
  sed -i "s|^[[:space:]]*COMFYUI_WORKER_PORT=.*$|COMFYUI_WORKER_PORT=${HOST_HTTP_PORT}|" "${REMOTE_ENV_FILE}"
else
  printf '\nCOMFYUI_WORKER_PORT=%s\n' "${HOST_HTTP_PORT}" >> "${REMOTE_ENV_FILE}"
fi

if grep -Eq '^[[:space:]]*PAI_PROJECTS_MOUNT_ROOT=' "${REMOTE_ENV_FILE}"; then
  sed -i "s|^[[:space:]]*PAI_PROJECTS_MOUNT_ROOT=.*$|PAI_PROJECTS_MOUNT_ROOT=/data/pai-projects|" "${REMOTE_ENV_FILE}"
else
  printf '\nPAI_PROJECTS_MOUNT_ROOT=/data/pai-projects\n' >> "${REMOTE_ENV_FILE}"
fi

if grep -Eq '^[[:space:]]*COMFYUI_WORKER_PROJECTS_ROOT=' "${REMOTE_ENV_FILE}"; then
  sed -i "s|^[[:space:]]*COMFYUI_WORKER_PROJECTS_ROOT=.*$|COMFYUI_WORKER_PROJECTS_ROOT=/data/pai-projects|" "${REMOTE_ENV_FILE}"
else
  printf 'COMFYUI_WORKER_PROJECTS_ROOT=/data/pai-projects\n' >> "${REMOTE_ENV_FILE}"
fi

if grep -Eq '^[[:space:]]*COMFYUI_WORKER_REGISTRY_ROOT=' "${REMOTE_ENV_FILE}"; then
  sed -i "s|^[[:space:]]*COMFYUI_WORKER_REGISTRY_ROOT=.*$|COMFYUI_WORKER_REGISTRY_ROOT=/data/pai-projects/.pai-workers|" "${REMOTE_ENV_FILE}"
else
  printf 'COMFYUI_WORKER_REGISTRY_ROOT=/data/pai-projects/.pai-workers\n' >> "${REMOTE_ENV_FILE}"
fi

cd "${APP_DIR}"
docker compose -f "${COMPOSE_FILE}" --env-file "${REMOTE_ENV_FILE}" up -d --build
