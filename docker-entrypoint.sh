#!/bin/sh
set -eu

PROJECTS_ROOT="${PAI_PROJECTS_MOUNT_ROOT:-${COMFYUI_WORKER_PROJECTS_ROOT:-/data/pai-projects}}"
REGISTRY_ROOT="${COMFYUI_WORKER_REGISTRY_ROOT:-${PROJECTS_ROOT}/.pai-workers}"
CACHE_ROOT="${PAI_CACHE_DIR:-/var/cache/pai}"
TMP_ROOT="${PAI_TMP_DIR:-/var/tmp/pai}"
LOG_ROOT="${PAI_LOG_DIR:-/var/log/pai}"

export PAI_PROJECTS_MOUNT_ROOT="${PROJECTS_ROOT}"
export COMFYUI_WORKER_PROJECTS_ROOT="${COMFYUI_WORKER_PROJECTS_ROOT:-$PROJECTS_ROOT}"
export COMFYUI_WORKER_REGISTRY_ROOT="${REGISTRY_ROOT}"
export PAI_CACHE_DIR="${CACHE_ROOT}"
export PAI_TMP_DIR="${TMP_ROOT}"
export PAI_LOG_DIR="${LOG_ROOT}"

mkdir -p "${PROJECTS_ROOT}" "${REGISTRY_ROOT}" "${CACHE_ROOT}" "${TMP_ROOT}" "${LOG_ROOT}"

case "${1:-container}" in
  container)
    shift || true
    exec /usr/bin/tini -- /usr/local/bin/start-container.sh "$@"
    ;;
  server)
    shift || true
    exec node ./dist/index.js "$@"
    ;;
  worker)
    shift || true
    exec node ./dist/queue/worker-cli.js "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
