# 08 — Despliegue

## 1. Fase VPS (Docker Compose)

VPS recomendado para empezar: 8 vCPU / 16 GB RAM / 200 GB NVMe (Hetzner/Contabo/OVH). Todo containerizado desde el día 1 para que la migración a K8s sea de orquestación, no de empaquetado.

```yaml
# infra/compose/docker-compose.yml (esquema; el real se genera en F0)
services:
  traefik:        # TLS automático (Let's Encrypt), enrutamiento, rate limit L7
  web:            # Next.js (standalone output)
  api:            # NestJS HTTP+WS  (réplicas: 2)
  webhook:        # mismo build que api, MODE=webhook (aislado: si el api cae,
                  # los webhooks de Meta se siguen recibiendo)
  worker:         # mismo build, MODE=worker (réplicas: 2, escalar por cola)
  ai-service:     # FastAPI (uvicorn, réplicas: 2)
  postgres:       # 16 + pgvector, volumen NVMe
  redis:          # AOF everysecond (persistencia de colas)
  loki + prometheus + grafana + tempo   # observabilidad self-hosted
```

**Decisión Traefik vs NGINX:** Traefik — certificados automáticos y descubrimiento por labels de Docker, menos config manual; NGINX no aporta nada diferencial aquí.

Dockerfiles: multi-stage (build → runner distroless/alpine), usuario no-root, `HEALTHCHECK`, imagen `api` única con `MODE` para api/webhook/worker (un solo artefacto, tres roles).

## 2. CI/CD (GitHub Actions)

```
PR:    lint + typecheck + unit + integration (Postgres/Redis en services)
       + build de imágenes (sin push)
main:  todo lo anterior → push a GHCR con tag sha → deploy staging (auto)
tag v*: deploy producción:
       1. ssh al VPS (deploy key, IP allowlist)
       2. docker compose pull
       3. prisma migrate deploy   (estrategia expand→contract, sin downtime)
       4. rolling restart por servicio (compose up -d --no-deps <svc>)
       5. smoke tests (health endpoints) → rollback automático a tag anterior si fallan
```

## 3. Backups y recuperación

- **PostgreSQL:** `pgBackRest` — full semanal, incremental diario, WAL archiving continuo a R2 → **PITR** (restauración a un punto en el tiempo). Objetivos: RPO ≤ 5 min, RTO ≤ 1 h.
- Redis: RDB cada 6 h a R2 (las colas toleran pérdida corta; los datos maestros están en Postgres).
- R2: versionado de objetos habilitado.
- **Prueba de restauración mensual automatizada** (job que restaura el último backup en un contenedor efímero y corre verificaciones) — un backup no probado no es un backup.

## 4. Observabilidad y alertas

- Métricas RED por servicio + profundidad de colas BullMQ + latencia hacia Meta + tokens IA por tenant.
- Alertas (Grafana → email/Telegram): p99 webhook ACK > 2s, cola inbound > 1000 jobs, DLQ > 0, tokens Meta expirando sin renovar, disco > 80%, certificados por vencer.
- Trazas OpenTelemetry extremo a extremo: webhook → worker → ai-service → Meta (un `trace_id` por mensaje).

## 5. Ruta a Kubernetes (fase 2, sin reescritura)

Disparadores para migrar: >200 tenants activos, necesidad de autoscaling real, o requisito de 99.9%.

| Pieza en VPS | En Kubernetes |
|---|---|
| Compose services | Deployments + HPA (workers escalan por profundidad de cola vía KEDA) |
| Traefik | Ingress NGINX/Traefik + cert-manager |
| Postgres contenedor | **Gestionado** (RDS/Cloud SQL/Neon) — no operar Postgres en K8s |
| Redis contenedor | Gestionado (Upstash/ElastiCache) o Redis Operator |
| `.env` + SOPS | External Secrets Operator |
| deploy por SSH | ArgoCD (GitOps: el repo `infra/k8s` es la fuente de verdad) |
| BullMQ | Se mantiene; si el volumen lo exige, `EventBus` cambia a RabbitMQ/Kafka sin tocar dominios |

Lo único que cambia es `infra/`; las aplicaciones ya son stateless, ya leen config de env, ya exponen health/readiness endpoints y ya publican métricas.
