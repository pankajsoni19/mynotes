FROM oven/bun:1.2.22-alpine AS dependencies
WORKDIR /app
COPY package.json ./
RUN bun install

FROM dependencies AS build
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN bun run build

FROM oven/bun:1.2.22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production \
    PORT=2026 \
    DATA_DIR=/data
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /data && chown -R bun:bun /app /data
USER bun
EXPOSE 2026
HEALTHCHECK --interval=15s --timeout=3s --start-period=8s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:2026/api/health || exit 1
CMD ["bun", "server/index.ts"]

