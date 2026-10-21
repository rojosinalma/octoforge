# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# deps: every workspace dependency (dev included) for the build stage
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY vendor/tailor-react/package.json vendor/tailor-react/
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: production build of the SPA (the server runs from source under bun)
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY vendor vendor
COPY packages packages
RUN bun run --filter @octoforge/web build

# ---------------------------------------------------------------------------
# prod-deps: runtime node_modules only
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.3-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY vendor/tailor-react/package.json vendor/tailor-react/
RUN bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.3-slim AS runtime

LABEL org.opencontainers.image.title="Octoforge" \
      org.opencontainers.image.description="Home of a family of self-hosted GitHub tools: an index with live status, a GitHub credentials helper and a shared database host." \
      org.opencontainers.image.source="https://github.com/rojosinalma/octoforge" \
      org.opencontainers.image.url="https://github.com/rojosinalma/octoforge" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

# The base image ships a `bun` user with uid 1000; rename it so the container user is `octoforge`.
RUN usermod -l octoforge -d /home/octoforge -m bun \
 && groupmod -n octoforge bun \
 && mkdir -p /data /app \
 && chown octoforge:octoforge /data /app

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST=/app/packages/web/dist \
    MEMBERS_FILE=/app/members.json

# Bun installs in isolated mode: the store lives in node_modules/.bun and every workspace package
# gets its own node_modules of symlinks into it, so each tree is copied.
COPY --from=prod-deps --chown=octoforge:octoforge /app/node_modules ./node_modules
COPY --from=prod-deps --chown=octoforge:octoforge /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=prod-deps --chown=octoforge:octoforge /app/packages/server/node_modules packages/server/node_modules
COPY --chown=octoforge:octoforge package.json ./
# The member list: one card per entry.
COPY --chown=octoforge:octoforge members.json ./
COPY --chown=octoforge:octoforge packages/shared/package.json packages/shared/
COPY --chown=octoforge:octoforge packages/shared/src packages/shared/src
COPY --chown=octoforge:octoforge packages/server/package.json packages/server/
COPY --chown=octoforge:octoforge packages/server/src packages/server/src
COPY --from=build --chown=octoforge:octoforge /app/packages/web/dist packages/web/dist

USER octoforge
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "packages/server/src/index.ts"]
