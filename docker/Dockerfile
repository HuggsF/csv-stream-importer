# Production image: multi-stage build, only compiled JS + production dependencies, non-root.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
# Heap budget for the HTTP server (see docs/adr/004-memory-budget-and-heap-tuning.md)
ENV NODE_OPTIONS="--max-old-space-size=256 --max-semi-space-size=2"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p output uploads data && chown -R node:node output uploads data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# HTTP API by default; the CLI is available as `node dist/presentation/cli/main.js import --file …`
CMD ["node", "dist/index.js"]
