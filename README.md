# WOLFIAX SOCIAL AI

SaaS multi-tenant de Wolfiax para automatización inteligente de DMs de Instagram usando exclusivamente las APIs oficiales de Meta.

Documentación de diseño: [docs/](docs/00-VISION-Y-ALCANCE.md)

## Estructura

```
apps/
  api/         NestJS — API REST, auth, multi-tenancy (F0: módulo IAM)
  web/         Next.js — dashboard
  ai-service/  FastAPI — motor de IA (F0: esqueleto)
packages/
  shared/      Tipos y contratos compartidos (TS)
infra/         Docker, compose, scripts
```

## Requisitos

- Node.js >= 22 (con corepack para pnpm)
- Docker Desktop (Postgres + Redis locales)
- Python >= 3.12 (solo para ai-service)

## Puesta en marcha (desarrollo)

```bash
# 1. Dependencias
corepack enable pnpm
pnpm install

# 2. Infraestructura local (Postgres + Redis)
docker compose -f infra/compose/docker-compose.dev.yml up -d

# 3. Variables de entorno
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Genera las claves JWT y pégalas en apps/api/.env:
node infra/scripts/generate-jwt-keys.mjs

# 4. Migraciones
pnpm --filter @wolfiax/api exec prisma migrate deploy

# 5. Levantar todo
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000 (Swagger: http://localhost:4000/docs con `SWAGGER_ENABLED=true`)
- Healthcheck: http://localhost:4000/healthz

## Comandos

| Comando | Descripción |
|---|---|
| `pnpm dev` | Levanta web + api en watch |
| `pnpm build` | Build de todos los paquetes |
| `pnpm typecheck` | TypeScript en todo el monorepo |
| `pnpm test` | Tests unitarios |
| `pnpm --filter @wolfiax/api test:e2e` | Tests e2e (requiere Postgres) |
| `pnpm lint` | ESLint |

## Nota sobre OneDrive

Este repositorio vive en una carpeta sincronizada por OneDrive. `node_modules` genera decenas de miles de archivos pequeños que degradan la sincronización. Recomendado: excluir `node_modules` de OneDrive (clic derecho → "Liberar espacio" no basta; usar "Elegir carpetas" o mover el repo fuera de OneDrive y dejar solo el remoto Git como respaldo).
