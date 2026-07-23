# This Dockerfile is built from the monorepo root (see docker-compose.yml:
# build.context: ., build.dockerfile: apps/api/Dockerfile) so that apps/api's
# tsconfig.json can resolve its "../../tsconfig.base.json" extends and npm
# workspaces can install/hoist correctly.

# ─── Base Stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl curl
WORKDIR /app

# ─── Dependencies Stage ──────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --workspace=apps/api --omit=dev && npm cache clean --force

# ─── Development Stage ───────────────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install
COPY . .
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
EXPOSE 3000 9229
CMD ["npm", "run", "dev", "--workspace=apps/api"]

# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci
COPY . .
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=apps/api

# ─── Production Stage ────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy production node_modules (includes hoisted @prisma/client and .prisma)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/package.json ./package.json

# Set proper ownership
RUN chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["node", "apps/api/dist/main"]
