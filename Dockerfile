FROM oven/bun:1.2.22-alpine@sha256:ab596b6d0dcad05d23799b89451e92f4cdc16da184a9a4d240c42eaf3c4b9278 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN bun run build

FROM dependencies AS verify
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY tests ./tests
COPY bunfig.toml ./
RUN bun run typecheck && bun test && bun run build

FROM oven/bun:1.2.22-alpine@sha256:ab596b6d0dcad05d23799b89451e92f4cdc16da184a9a4d240c42eaf3c4b9278 AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.2.22-alpine@sha256:ab596b6d0dcad05d23799b89451e92f4cdc16da184a9a4d240c42eaf3c4b9278 AS production
WORKDIR /app
ARG APP_VERSION=0.2.4
ARG GIT_SHA=development
ENV NODE_ENV=production \
    PORT=2026 \
    DATA_DIR=/data \
    APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA
COPY --chown=bun:bun --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=bun:bun --from=production-dependencies /app/package.json ./package.json
COPY --chown=bun:bun --from=build /app/dist ./dist
COPY --chown=bun:bun server ./server
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 2026
HEALTHCHECK --interval=15s --timeout=3s --start-period=8s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:2026/api/health || exit 1
CMD ["bun", "server/index.ts"]
