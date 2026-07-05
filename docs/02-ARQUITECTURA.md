# 02 — Arquitectura

## 1. Decisión estructural: monolito modular + servicio de IA (no microservicios día 1)

**Decisión:** dos servicios desplegables + workers, no una malla de microservicios.

1. **`api` (NestJS/TypeScript)** — monolito modular: auth, tenants, canal Meta, inbox, automatizaciones, flujos, analítica, ingesta de webhooks.
2. **`ai-service` (FastAPI/Python)** — todo lo de IA: RAG, embeddings, clasificación de intención/sentimiento, resúmenes, extracción. Aislado porque el ecosistema de IA es Python (LangChain, parsers de documentos) y porque su perfil de escalado es distinto (CPU/latencia LLM).
3. **`workers` (NestJS, mismo código base que `api`, otro entrypoint)** — consumidores de colas: procesamiento de mensajes, ejecución de flujos, ingesta de conocimiento, envíos a Meta, analítica.

**Por qué no microservicios ahora:** con un solo equipo y un VPS, los microservicios multiplican costos de operación (red, versionado de contratos, debugging distribuido) sin beneficio. El monolito NestJS se organiza en **módulos con límites DDD estrictos** (cada módulo expone servicios, no toca tablas de otro módulo); si mañana "flows" necesita escalar aparte, se extrae con su módulo y su cola. Los contratos ya son asíncronos (eventos por cola), que es el 80% del trabajo de una extracción.

## 2. Diagrama de componentes

```
                         ┌──────────────── Meta ────────────────┐
                         │  Graph API / IG Messaging / OAuth    │
                         └───────▲──────────────────┬───────────┘
                          envíos │                  │ webhooks (POST firmado)
                                 │                  ▼
┌──────────┐  HTTPS   ┌──────────┴───────────────────────────────┐
│ Next.js  │────────► │            NGINX / Traefik               │
│ (web app)│          │  TLS, rate limit L7, /webhooks dedicado  │
└──────────┘          └───────┬──────────────────────┬───────────┘
                              │ /api/v1              │ /webhooks/meta
                              ▼                      ▼
                      ┌───────────────┐      ┌────────────────┐
                      │  api (NestJS) │      │ webhook-ingest │  (módulo del api;
                      │  REST + WS    │      │ verifica firma,│   proceso separado
                      └──┬───────┬────┘      │ ACK 200, encola│   en producción)
                         │       │           └───────┬────────┘
             PostgreSQL ◄┘       └► Redis            │
             (+pgvector)            (cache, BullMQ) ◄┘
                         ▲       ▲
                         │       │  colas: inbound, outbound, flows,
                         │       │         ingest, analytics, tokens
                      ┌──┴───────┴────┐         ┌─────────────────┐
                      │    workers    │ ──────► │ ai-service      │
                      │   (NestJS)    │  HTTP   │ (FastAPI)       │
                      └──────┬────────┘  intra  │ RAG, LLM, embed │
                             │                  └───────┬─────────┘
                             ▼                          ▼
                      S3 / Cloudflare R2         LLM provider (Claude/OpenAI)
                      (media, documentos)        vía capa de abstracción
```

Comunicación en tiempo real hacia el frontend (nuevos mensajes en el inbox): **WebSocket (Socket.IO) desde `api`**, con adaptador Redis pub/sub para funcionar con múltiples réplicas.

## 3. Stack tecnológico y justificación

| Capa | Elección | Por qué (frente a alternativas) |
|---|---|---|
| Frontend | **Next.js 15 + React 19 + TypeScript + Tailwind + shadcn/ui** | SSR para el sitio público y dashboard; shadcn/ui da componentes accesibles sin lock-in. |
| Flow builder | **React Flow (xyflow)** | Estándar de facto para editores de nodos (lo usan Typebot, Langflow); evita construir un canvas desde cero. |
| Backend | **NestJS 11 + TypeScript** | DI nativa, módulos = límites DDD, guards/interceptors para multi-tenancy, ecosistema maduro (BullMQ, Passport, Swagger). |
| Servicio IA | **FastAPI + Python 3.12** | Ecosistema de parsers (unstructured, pypdf, python-docx, openpyxl) y LangChain/LlamaIndex. |
| ORM | **Prisma (api) / SQLAlchemy (ai-service)** | Prisma: migraciones declarativas y tipos generados. Nota: RLS exige cuidado con el pooling — ver doc 07. |
| BD | **PostgreSQL 16 + pgvector** | Una sola BD transaccional + vectorial. **Se descarta un vector DB dedicado (Pinecone/Qdrant) en fase 1**: pgvector con índice HNSW maneja millones de chunks; menos infra que operar. Interfaz `VectorStore` para poder cambiar después. |
| Cache/colas | **Redis 7 + BullMQ** | **Se descarta RabbitMQ/Kafka en fase 1**: BullMQ da reintentos, DLQ, prioridades, delayed jobs (necesario para el nodo "Esperar" del flow builder) con una sola pieza de infra que además sirve de cache y rate limiter. Kafka solo se justificará con volúmenes de eventos de analítica muy altos; la interfaz `EventBus` abstrae el transporte. |
| Storage | **Cloudflare R2 (API S3)** | Sin costo de egreso (media de IG se re-sirve al frontend); compatible S3 → portable. |
| LLM | **Capa de abstracción propia (`LlmProvider`)** con Claude y OpenAI | El tenant no elige proveedor en MVP; Wolfiax puede cambiar por costo/calidad. Embeddings: modelo de embeddings del proveedor elegido, dimensión fijada en config. |
| Observabilidad | **OpenTelemetry + Grafana stack (Loki/Prometheus/Tempo) + Sentry** | Todo self-hosted en el VPS fase 1; Sentry SaaS para errores. |
| Contenedores | **Docker Compose (VPS) → Kubernetes (fase 2)** | Ver doc 08. |
| CI/CD | **GitHub Actions** | Build, test, push a registry, deploy por SSH (fase 1) / ArgoCD (fase 2). |

## 4. Multi-tenancy

**Modelo: base de datos compartida, filas compartidas, discriminador `organization_id` + Row-Level Security de PostgreSQL.**

- Alternativas descartadas: *BD por tenant* (miles de BDs = pesadilla de migraciones y costos) y *schema por tenant* (mismo problema a menor escala). El modelo de filas compartidas escala a miles de tenants y RLS da defensa en profundidad: aunque un bug omita el `WHERE organization_id`, Postgres no devuelve filas de otro tenant.
- Implementación: middleware resuelve el tenant desde el JWT → `SET LOCAL app.current_org_id` en la transacción → políticas RLS en cada tabla tenant-scoped. Detalles en docs 03 y 07.
- Aislamiento fuera de la BD: prefijos por tenant en claves Redis, colas con `organization_id` en el payload, buckets con prefijo `org/{id}/` en R2, filtro `organization_id` en metadatos de vectores.

## 5. Módulos del backend (límites DDD)

| Módulo | Responsabilidad | Publica eventos | Consume |
|---|---|---|---|
| `iam` | usuarios, organizaciones, roles, invitaciones, JWT | `user.created` | — |
| `channels` | conexión Meta, tokens, renovación, health-check | `channel.connected/disconnected` | cron renovación |
| `webhooks` | verificación de firma, dedupe, encolado | `message.received`, `reaction.received`… | — |
| `inbox` | conversaciones, mensajes, etiquetas, notas, asignación | `conversation.updated` | `message.received` |
| `automations` | reglas trigger/condición/acción | `automation.fired` | `message.received`… |
| `flows` | definición y **ejecución** de flujos (state machine) | `flow.completed` | `automation.fired`, timers |
| `ai` | proxy a ai-service, presupuestos de tokens, guardrails | `ai.replied` | `flow` y `automations` |
| `knowledge` | fuentes, ingesta, versionado de KB | `knowledge.updated` | jobs de ingesta |
| `messaging` | envío a Meta (outbound), ventana 24h, rate limit, reintentos | `message.sent/failed` | todos los anteriores |
| `analytics` | proyecciones de eventos → tablas de métricas | — | todos los eventos |
| `billing` (F6) | planes, límites, uso | `limit.exceeded` | contadores |

**CQRS ligero:** solo en analítica (los eventos de dominio se proyectan a tablas de lectura desnormalizadas). No se aplica CQRS/event-sourcing al resto: complejidad sin beneficio a esta escala.

## 6. Escalabilidad

- `api`, `workers` y `ai-service` son stateless → réplicas horizontales tras el balanceador.
- Orden por conversación: las colas de BullMQ usan grupos/locks por `conversation_id` para no procesar dos mensajes de la misma conversación en paralelo (evita respuestas desordenadas).
- Postgres: índices por `(organization_id, …)`, particionado de `messages` por rango de fecha cuando supere ~50M filas; réplica de lectura para analítica en fase K8s.
- Picos (p. ej. un tenant recibe 10k story replies tras una publicación viral): el webhook solo encola; los workers drenan a su ritmo; rate limiter por cuenta IG hacia Meta.
