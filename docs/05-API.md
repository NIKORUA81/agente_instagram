# 05 — Diseño de API REST

## 1. Convenciones

- Base: `https://api.wolfiax.com/api/v1` — versionado por path.
- JSON; snake_case en payloads; IDs UUID; paginación por cursor (`?cursor=…&limit=50`); filtros por query params.
- Docs: OpenAPI 3 generada por decoradores NestJS (`/docs` Swagger UI, protegido en producción).
- Validación: DTOs con `class-validator`; toda entrada se valida antes de tocar servicios.
- Idempotencia en POSTs de envío: header `Idempotency-Key` (se guarda 24h en Redis).

### Errores (formato único)
```json
{
  "error": {
    "code": "CONVERSATION_WINDOW_CLOSED",
    "message": "La ventana de 24 horas para esta conversación expiró.",
    "details": [{ "field": "…", "issue": "…" }],
    "request_id": "req_01J…"
  }
}
```
HTTP: 400 validación · 401 sin auth · 403 sin permiso/rol · 404 no existe **en este tenant** · 409 conflicto · 422 regla de negocio (p. ej. ventana cerrada) · 429 rate limit (con `Retry-After`) · 5xx con `request_id` para soporte.

### Autenticación
- **Dashboard:** `Authorization: Bearer <access JWT>` (15 min, claims: `sub`, `org`, `role`) + refresh token (30 días, rotado, en cookie httpOnly `SameSite=Strict` para el web app). Cambio de organización re-emite el access token.
- **API pública (integraciones/CRM):** `X-Api-Key: wsk_live_…` con scopes (`conversations:read`, `messages:send`, …).
- Rate limits (Redis sliding window): 100 req/min por usuario, 600 req/min por API key (por plan), 10 req/min en auth endpoints.

## 2. Endpoints por módulo

### Auth y organización
```
POST   /auth/register                 → crea user + organization (owner)
POST   /auth/login                    → {access_token} + set-cookie refresh
POST   /auth/refresh                  → rota refresh, nuevo access
POST   /auth/logout                   → revoca familia de refresh
GET    /auth/me                       → perfil + organizaciones + rol
POST   /orgs/:id/switch               → access token con claim org nuevo
GET    /orgs/:id            PATCH /orgs/:id
GET    /orgs/:id/members    POST /orgs/:id/invitations
PATCH  /orgs/:id/members/:userId      → cambiar rol   DELETE → remover
GET    /orgs/:id/audit-logs           → (admin) paginado
GET    /orgs/:id/api-keys   POST/DELETE                → gestión API keys
```

### Módulo 1 — Conexión Meta
```
POST   /channels/instagram/connect    → {authorization_url} (elige connection_type)
GET    /channels/instagram/callback   → callback OAuth (redirige al dashboard)
GET    /channels                      → lista con status y salud
GET    /channels/:id                  → detalle: scopes, expiración, checklist salud
POST   /channels/:id/select-account   → fija cuenta IG cuando hay varias
POST   /channels/:id/health-check     → fuerza verificación
POST   /channels/:id/reconnect        → re-OAuth conservando historial
DELETE /channels/:id                  → desconecta (revoca suscripción webhook)
```

### Módulo 2 — Inbox
```
GET    /conversations                 ?status=&mode=&tag=&assigned_to=&q=&cursor=
GET    /conversations/:id             → detalle + contacto + ventana 24h restante
GET    /conversations/:id/messages    ?cursor=   (descendente)
POST   /conversations/:id/messages    → envía como agente {type, text|attachment_id}
                                        422 si ventana cerrada (salvo human_agent)
PATCH  /conversations/:id             → {status | assigned_user_id | mode}
POST   /conversations/:id/handover    → a humano   POST /return-to-ai → devuelve
POST   /conversations/:id/tags        DELETE /conversations/:id/tags/:tagId
GET/POST /conversations/:id/notes
POST   /attachments                   → presigned upload a R2 → {attachment_id}
GET    /contacts                      ?q=&lifecycle=&cursor=
GET    /contacts/:id                  → perfil + datos extraídos + conversaciones
PATCH  /contacts/:id                  → editar atributos/lifecycle
GET/POST/PATCH/DELETE /tags
```

### Módulos 3 y 6 — IA y conocimiento
```
GET/PATCH /channels/:id/ai-profile    → prompt, tono, disclosure, guardrails, horarios
POST   /ai/test-reply                 → sandbox: prueba la IA sin enviar a IG
GET    /knowledge/sources             POST (multipart o {url|faq_items|text})
GET    /knowledge/sources/:id         → status de ingesta, chunks, errores
POST   /knowledge/sources/:id/refresh → re-crawl / re-proceso
DELETE /knowledge/sources/:id
POST   /knowledge/search              → {query} → chunks (debug del RAG para el admin)
GET/POST/PATCH/DELETE /catalog/items  → catálogo estructurado
```

### Módulo 4 — Flujos
```
GET/POST /flows                       GET/PATCH/DELETE /flows/:id
GET    /flows/:id/versions            GET /flows/:id/versions/:v
PUT    /flows/:id/draft               → guarda grafo (autosave)
POST   /flows/:id/publish             → valida grafo (nodos huérfanos, loops
                                        infinitos, ramas sin fin) → nueva versión
POST   /flows/:id/test                → ejecución simulada paso a paso (sandbox)
GET    /flows/:id/executions          ?status=   → monitoreo
GET    /flow-executions/:id/steps     → traza para debugging visual
POST   /flow-executions/:id/cancel
```

### Módulo 5 — Automatizaciones
```
GET/POST /automations                 GET/PATCH/DELETE /automations/:id
POST   /automations/:id/toggle
GET    /automations/:id/stats         → fires, últimos disparos
POST   /automations/test              → evalúa un mensaje de ejemplo contra reglas
```

### Módulo 7 — Analítica
```
GET    /analytics/overview            ?from=&to=&channel_id=   → KPIs del dashboard
GET    /analytics/conversations       → series temporales
GET    /analytics/response-times      GET /analytics/intents
GET    /analytics/agents              → rendimiento por agente
GET    /analytics/ai-usage            → tokens, costo estimado, tasa de resolución
GET    /analytics/csat
POST   /analytics/export              → job asíncrono → CSV/XLSX por email/descarga
```

### Webhooks (Meta → nosotros, y nosotros → integraciones)
```
GET    /webhooks/meta                 → verificación hub.challenge (sin auth JWT)
POST   /webhooks/meta                 → eventos (auth por firma HMAC, no JWT)
GET/POST/DELETE /integrations/webhooks → webhooks salientes del tenant
                                        (eventos: message.received, handover, …
                                         firmados con HMAC del tenant)
```

## 3. WebSocket (Socket.IO, namespace /realtime)

Auth por access token en handshake; salas por `org:{id}` y `conversation:{id}`.
Eventos servidor→cliente: `message.new`, `message.status`, `conversation.updated`, `handover.requested`, `channel.status`. Cliente→servidor: `typing`, `conversation.read`.
