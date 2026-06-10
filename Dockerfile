FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY db ./db

RUN npm run compile && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PAI_PROJECTS_MOUNT_ROOT=/data/pai-projects \
    COMFYUI_WORKER_PROJECTS_ROOT=/data/pai-projects \
    COMFYUI_WORKER_REGISTRY_ROOT=/data/pai-projects/.pai-workers \
    PAI_CACHE_DIR=/var/cache/pai \
    PAI_TMP_DIR=/var/tmp/pai \
    PAI_LOG_DIR=/var/log/pai

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /data/pai-projects /var/cache/pai /var/tmp/pai /var/log/pai \
    && chown -R node:node /app /data/pai-projects /var/cache/pai /var/tmp/pai /var/log/pai \
    && chmod +x /app/docker-entrypoint.sh

USER node

EXPOSE 8091

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["server"]
