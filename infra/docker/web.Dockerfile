# syntax=docker/dockerfile:1
# Next.js standalone. Contexto de build: la RAÍZ del repo:
#   docker build -f infra/docker/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.wolfiax.com -t wolfiax/web .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @wolfiax/web... --filter @wolfiax/shared

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @wolfiax/shared build \
 && pnpm --filter @wolfiax/web build

FROM node:22-bookworm-slim AS runner
RUN useradd --system --uid 1001 nodeapp
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=nodeapp:nodeapp /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nodeapp:nodeapp /repo/apps/web/.next/static ./apps/web/.next/static
USER nodeapp
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
