# ---------- Stage 1: frontend build ----------
FROM node:26-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: production ----------
FROM node:26-alpine

# Short commit SHA injected by CI (shown in the UI footer)
ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="DockerUpdates" \
      org.opencontainers.image.source="https://github.com/PixlGalaxy/DockerUpdates"

ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./public
COPY LICENSE /app/LICENSE

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

# Runs as root: access to /var/run/docker.sock requires it
# (access to the socket is root-equivalent on the host anyway).
CMD ["node", "server.js"]
