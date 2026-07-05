# syntax=docker/dockerfile:1
# Build multi-stage del API NestJS (monorepo pnpm).
# Contexto de build: la RAÍZ del repo:
#   docker build -f infra/docker/api.Dockerfile -t wolfiax/api .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# ---- deps + build -----------------------------------------------------------
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @wolfiax/api... --filter @wolfiax/shared

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @wolfiax/shared build \
 && pnpm --filter @wolfiax/api build

# Copia deployable con solo dependencias de producción
RUN pnpm --filter @wolfiax/api deploy --prod /prod/api \
 && cp -r apps/api/dist /prod/api/dist \
 && cp -r apps/api/prisma /prod/api/prisma
# El cliente Prisma se genera dentro del deploy para que los engines queden en su sitio
WORKDIR /prod/api
RUN ./node_modules/.bin/prisma generate

# ---- runner -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1001 nodeapp
WORKDIR /app
COPY --from=build --chown=nodeapp:nodeapp /prod/api /app
USER nodeapp
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD curl -fsS http://localhost:4000/healthz || exit 1
# MODE distingue roles futuros (api | webhook | worker) con la misma imagen
ENV MODE=api
CMD ["node", "dist/main.js"]
