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

# 1. Genera el cliente Prisma con el target correcto (debian-openssl-3.0.x)
#    Debe correr ANTES del deploy para que pnpm tenga acceso a la CLI de dev
RUN pnpm --filter @wolfiax/shared build \
 && pnpm --filter @wolfiax/api exec prisma generate \
 && pnpm --filter @wolfiax/api build

# 2. Crea el directorio de producción con solo dependencias de producción
RUN pnpm --filter @wolfiax/api deploy --prod /prod/api \
 && cp -r apps/api/dist /prod/api/dist \
 && cp -r apps/api/prisma /prod/api/prisma

# 3. Copia el cliente generado de Prisma al directorio de producción
#    pnpm lo coloca en la tienda virtual; buscamos en todas las ubicaciones posibles
RUN PRISMA_CLIENT_SRC=$(find /repo -path "*/.prisma/client" -type d 2>/dev/null | head -1) \
 && if [ -n "$PRISMA_CLIENT_SRC" ]; then \
      mkdir -p /prod/api/node_modules/.prisma/client; \
      cp -r "$PRISMA_CLIENT_SRC"/. /prod/api/node_modules/.prisma/client/; \
      echo "✅ Prisma client copiado desde $PRISMA_CLIENT_SRC"; \
    else \
      echo "⚠️ No se encontró .prisma/client — el cliente se buscará en runtime"; \
    fi

# ---- runner -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1001 nodeapp
WORKDIR /app
COPY --from=build --chown=nodeapp:nodeapp /prod/api /app
# Entrypoint que aplica migraciones antes de arrancar (prisma va en dependencies
# de producción, así que ./node_modules/.bin/prisma existe en la imagen).
COPY --from=build --chown=nodeapp:nodeapp /repo/apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
USER nodeapp
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD curl -fsS http://localhost:4000/healthz || exit 1
# MODE distingue roles futuros (api | webhook | worker) con la misma imagen
ENV MODE=api
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
