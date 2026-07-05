# 06 — Estructura de Carpetas (Monorepo)

**Decisión: monorepo con pnpm workspaces + Turborepo.** Un solo repo para api, workers, frontend y servicio IA: tipos compartidos (`packages/shared`) sin publicar paquetes, CI unificado, refactors atómicos. El servicio Python vive en el mismo repo (carpeta propia con su tooling).

```
wolfiax-social-ai/
├── apps/
│   ├── web/                          # Next.js 15 (App Router)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (marketing)/      # landing pública
│   │   │   │   ├── (auth)/login|register|invite/
│   │   │   │   └── (dashboard)/
│   │   │   │       ├── inbox/        # bandeja + conversación
│   │   │   │       ├── contacts/
│   │   │   │       ├── flows/        # lista + editor React Flow
│   │   │   │       ├── automations/
│   │   │   │       ├── knowledge/    # fuentes, catálogo, prueba de IA
│   │   │   │       ├── analytics/
│   │   │   │       └── settings/     # canal Meta, IA, equipo, API keys, billing
│   │   │   ├── components/
│   │   │   │   ├── ui/               # shadcn
│   │   │   │   ├── inbox/  flow-editor/  analytics/ ...
│   │   │   ├── lib/                  # api-client (generado de OpenAPI), ws, auth
│   │   │   ├── hooks/  stores/       # TanStack Query + Zustand
│   │   │   └── i18n/                 # es primero, en después
│   │   └── package.json
│   │
│   ├── api/                          # NestJS — REST + WS + webhook ingest
│   │   ├── src/
│   │   │   ├── main.ts               # entrypoint HTTP
│   │   │   ├── worker.ts             # entrypoint workers (mismo código, flag)
│   │   │   ├── modules/
│   │   │   │   ├── iam/              # auth, users, orgs, memberships, invites
│   │   │   │   ├── channels/         # meta-oauth, tokens, health  (MetaConnector)
│   │   │   │   ├── webhooks/         # ingest, firma, dedupe, encolado
│   │   │   │   ├── inbox/            # conversations, messages, tags, notes
│   │   │   │   ├── contacts/
│   │   │   │   ├── automations/      # motor de reglas
│   │   │   │   ├── flows/            # crud, validación de grafo, ENGINE
│   │   │   │   ├── ai/               # cliente ai-service, guardrails, budgets
│   │   │   │   ├── knowledge/        # fuentes, jobs de ingesta, catálogo
│   │   │   │   ├── messaging/        # outbound a Meta, ventana 24h, rate limit
│   │   │   │   ├── analytics/        # proyecciones + endpoints de lectura
│   │   │   │   ├── integrations/     # webhooks salientes, API keys
│   │   │   │   └── billing/          # F6
│   │   │   │   └── (cada módulo: domain/ application/ infrastructure/ presentation/)
│   │   │   ├── common/               # guards (tenant, roles), interceptors,
│   │   │   │                         # filtros de error, decoradores, crypto
│   │   │   └── config/               # env tipado y validado (zod)
│   │   ├── prisma/  schema.prisma  migrations/
│   │   └── test/                     # unit junto al código; e2e aquí
│   │
│   └── ai-service/                   # FastAPI (Python 3.12, uv)
│       ├── app/
│       │   ├── main.py  config.py  deps.py
│       │   ├── api/v1/  (reply, analyze, ingest, embed, summarize)
│       │   ├── core/     llm/        # LlmProvider: claude.py, openai.py
│       │   │            rag/         # retriever, reranker, prompt_builder
│       │   │            parsers/     # pdf, docx, xlsx, web_crawler, faq
│       │   │            chunking/
│       │   ├── models/  schemas/     # pydantic
│       │   └── services/
│       └── tests/  pyproject.toml
│
├── packages/
│   ├── shared/                       # tipos TS compartidos: eventos de cola,
│   │                                 # enums, contratos WS, zod schemas
│   ├── eslint-config/  tsconfig/
│
├── infra/
│   ├── docker/                       # Dockerfiles por app
│   ├── compose/                      # docker-compose.yml + overrides dev/prod
│   ├── nginx/                        # (o traefik/) config del proxy
│   ├── k8s/                          # manifests fase 2 (helm chart propio)
│   └── scripts/                      # backup.sh, restore.sh, deploy.sh
│
├── .github/workflows/                # ci.yml, deploy.yml
├── docs/                             # estos documentos + ADRs (docs/adr/)
├── turbo.json  pnpm-workspace.yaml  package.json
└── README.md
```

### Anatomía de un módulo NestJS (Clean Architecture aplicada con pragmatismo)

```
modules/inbox/
├── domain/            # entidades y reglas puras (Conversation, ventana 24h)
├── application/       # casos de uso (SendAgentMessage, AssignConversation),
│                      # puertos (interfaces de repos y servicios externos)
├── infrastructure/    # PrismaConversationRepository, adaptadores BullMQ
└── presentation/      # controllers REST, gateways WS, DTOs
```

Reglas: `domain` no importa nada de Nest/Prisma; `application` depende de puertos (DI); los módulos se comunican entre sí **solo** por servicios públicos exportados o eventos — nunca tocando repositorios ajenos. Repository Pattern únicamente sobre agregados con lógica (conversations, flows, channels); para lecturas simples se permite Prisma directo en handlers de query (evita capas ceremoniales).
