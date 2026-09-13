# Bitta konteyner: frontend + Django API (ASGI/WebSocket) + nginx (:8080)
# Build:  docker build -t onlinetest:local .
# Run:    docker compose up --build

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY scripts/check-node.mjs ./scripts/
COPY .npmrc .nvmrc ./
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DJANGO_SETTINGS_MODULE=exam_platform.settings

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx curl ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/
COPY backend/requirements/ /app/backend/requirements/
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY --from=frontend-build /build/frontend/dist /app/frontend_dist

COPY deploy/docker/nginx.conf /etc/nginx/onlinetest.conf
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY scripts/docker-worker-entrypoint.sh /app/docker-worker-entrypoint.sh
COPY scripts/docker-beat-entrypoint.sh /app/docker-beat-entrypoint.sh
# Windows CRLF → LF (aks holda worker: /usr/bin/env: bash\r)
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh /app/docker-worker-entrypoint.sh /app/docker-beat-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh /app/docker-worker-entrypoint.sh /app/docker-beat-entrypoint.sh \
    && mkdir -p /data

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]
