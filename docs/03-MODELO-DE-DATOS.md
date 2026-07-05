# 03 — Modelo de Datos (PostgreSQL 16 + pgvector)

Convenciones: PK `id UUID DEFAULT gen_random_uuid()`; timestamps `created_at/updated_at TIMESTAMPTZ`; soft-delete solo donde se indica; **toda tabla tenant-scoped lleva `organization_id` NOT NULL + política RLS**; nombres en inglés, snake_case.

## 1. Diagrama entidad-relación (resumen)

```
organizations ─┬─< memberships >─ users
               ├─< channels ─┬─< conversations ─┬─< messages
               │             │                  ├─< conversation_tags >─ tags
               │             │                  ├─< notes
               │             │                  └─── contacts (N:1)
               │             └─< webhook_events
               ├─< contacts ─< contact_attributes
               ├─< automations
               ├─< flows ─< flow_versions ─< flow_executions ─< flow_execution_steps
               ├─< knowledge_sources ─< documents ─< chunks (vector)
               ├─< ai_profiles
               ├─< canned_responses
               ├─< api_keys
               ├─< audit_logs
               └─< analytics_daily / analytics_events
users ─< refresh_tokens
```

## 2. Tablas núcleo

### 2.1 IAM y tenancy

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial',        -- trial|starter|pro|enterprise
  settings JSONB NOT NULL DEFAULT '{}',      -- timezone, locale, branding
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT,                        -- NULL si solo SSO
  full_name TEXT NOT NULL,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,  -- staff Wolfiax
  mfa_secret_enc TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','agent','analyst')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,                  -- sha256, nunca el token en claro
  family_id UUID NOT NULL,                   -- detección de reuso (rotación)
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT, ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.2 Canales (conexión Meta)

```sql
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL DEFAULT 'instagram',
  connection_type TEXT NOT NULL CHECK (connection_type IN ('instagram_login','facebook_login')),
  ig_user_id TEXT NOT NULL,                  -- IGSID de la cuenta del negocio
  ig_username TEXT NOT NULL,
  fb_page_id TEXT,                           -- solo facebook_login
  access_token_enc BYTEA NOT NULL,           -- AES-256-GCM (ver doc 07)
  token_expires_at TIMESTAMPTZ,              -- NULL = long-lived page token
  granted_scopes TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','token_expired','revoked','disconnected','error')),
  last_health_check_at TIMESTAMPTZ,
  webhook_subscribed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ig_user_id)                        -- una cuenta IG conectada a un solo tenant
);

-- Registro crudo de webhooks para idempotencia y replay/debug
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES channels(id),
  external_id TEXT NOT NULL,                 -- mid del mensaje o hash del evento
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_id, event_type)           -- dedupe de reintentos de Meta
);
```

### 2.3 CRM ligero: contactos y conversaciones

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  channel_id UUID NOT NULL REFERENCES channels(id),
  ig_scoped_id TEXT NOT NULL,                -- IGSID del usuario final (por cuenta)
  username TEXT, name TEXT, profile_pic_url TEXT,
  is_follower BOOLEAN,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifecycle TEXT NOT NULL DEFAULT 'new'      -- new|engaged|customer|churned
    , extracted JSONB NOT NULL DEFAULT '{}'  -- datos que extrae la IA: tel, email…
  , UNIQUE (channel_id, ig_scoped_id)
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  channel_id UUID NOT NULL REFERENCES channels(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending','resolved','archived')),
  mode TEXT NOT NULL DEFAULT 'ai'            -- ai|human|flow  (quién conduce)
    CHECK (mode IN ('ai','human','flow')),
  assigned_user_id UUID REFERENCES users(id),
  window_expires_at TIMESTAMPTZ,             -- fin de la ventana de 24h
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  first_response_ms INT,                     -- métrica precalculada
  ai_summary TEXT,                           -- resumen mantenido por la IA
  sentiment TEXT, language TEXT, intent TEXT,
  csat_score SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, contact_id)            -- 1 conversación viva por contacto
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  source TEXT NOT NULL CHECK (source IN ('user','ai','flow','agent','automation','system')),
  mid TEXT UNIQUE,                           -- id de Meta (idempotencia)
  type TEXT NOT NULL DEFAULT 'text',         -- text|image|video|audio|story_reply|reaction|template|postback
  text TEXT,
  attachments JSONB NOT NULL DEFAULT '[]',   -- [{type,url,r2_key}]
  reply_to_story JSONB,                      -- {story_id, url} si story reply
  status TEXT NOT NULL DEFAULT 'received'    -- received|queued|sent|delivered|read|failed
    , error TEXT
  , sent_by_user_id UUID REFERENCES users(id)
  , ai_meta JSONB                            -- {model, tokens_in, tokens_out, latency_ms}
  , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#888888',
  UNIQUE (organization_id, name)
);
CREATE TABLE conversation_tags (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  PRIMARY KEY (conversation_id, tag_id)
);
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 IA y conocimiento

```sql
CREATE TABLE ai_profiles (                    -- configuración de la IA por canal
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  channel_id UUID NOT NULL REFERENCES channels(id) UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  system_prompt TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'professional', -- professional|friendly|casual|custom
  language_policy TEXT NOT NULL DEFAULT 'mirror',  -- mirror|fixed:<lang>
  disclosure_message TEXT NOT NULL,          -- aviso "soy un asistente" (obligatorio)
  handover_keywords TEXT[] NOT NULL DEFAULT '{humano,agente,persona}',
  guardrails JSONB NOT NULL DEFAULT '{}',    -- temas prohibidos, máx mensajes IA…
  business_hours JSONB,                      -- horarios y mensaje fuera de horario
  monthly_token_budget BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL CHECK (type IN ('pdf','docx','xlsx','url','faq','catalog','policy','text')),
  name TEXT NOT NULL,
  r2_key TEXT,                               -- archivo original en R2
  url TEXT,                                  -- para type=url (con re-crawl)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','ready','failed')),
  error TEXT,
  chunk_count INT NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',      -- página, sección, producto…
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Productos/servicios estructurados (el catálogo también se "chunkea" para RAG)
CREATE TABLE catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  sku TEXT, name TEXT NOT NULL, description TEXT,
  price NUMERIC(12,2), currency TEXT DEFAULT 'USD',
  stock INT, active BOOLEAN NOT NULL DEFAULT true,
  media JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.5 Automatizaciones y flujos

```sql
CREATE TABLE automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  channel_id UUID NOT NULL REFERENCES channels(id),
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger JSONB NOT NULL,     -- {type:'message_received'|'keyword'|'story_reply'|'reaction'|'new_contact'|..., params}
  conditions JSONB NOT NULL DEFAULT '[]',
  actions JSONB NOT NULL,     -- [{type:'reply'|'start_flow'|'add_tag'|'assign'|'webhook'|'ai_reply', params}]
  priority INT NOT NULL DEFAULT 100,
  cooldown_seconds INT NOT NULL DEFAULT 0,   -- anti-spam por contacto
  fire_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  active_version_id UUID,                    -- FK diferida a flow_versions
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INT NOT NULL,
  graph JSONB NOT NULL,        -- {nodes:[{id,type,data,position}], edges:[...]} (formato React Flow)
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  UNIQUE (flow_id, version)
);
CREATE TABLE flow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','waiting_input','waiting_timer','completed','failed','cancelled')),
  current_node_id TEXT,
  variables JSONB NOT NULL DEFAULT '{}',     -- estado del flujo
  wake_at TIMESTAMPTZ,                       -- para nodo "esperar"
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE TABLE flow_execution_steps (          -- traza para debugging visual
  id BIGSERIAL PRIMARY KEY,
  execution_id UUID NOT NULL REFERENCES flow_executions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  node_id TEXT NOT NULL, node_type TEXT NOT NULL,
  input JSONB, output JSONB, error TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.6 Analítica, auditoría, API pública

```sql
CREATE TABLE analytics_daily (               -- proyección CQRS de lectura
  organization_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  day DATE NOT NULL,
  conversations_new INT NOT NULL DEFAULT 0,
  conversations_resolved INT NOT NULL DEFAULT 0,
  messages_in INT NOT NULL DEFAULT 0,
  messages_out_ai INT NOT NULL DEFAULT 0,
  messages_out_human INT NOT NULL DEFAULT 0,
  contacts_new INT NOT NULL DEFAULT 0,
  contacts_returning INT NOT NULL DEFAULT 0,
  avg_first_response_ms INT,
  handovers INT NOT NULL DEFAULT 0,
  ai_tokens_in BIGINT NOT NULL DEFAULT 0,
  ai_tokens_out BIGINT NOT NULL DEFAULT 0,
  csat_sum INT NOT NULL DEFAULT 0, csat_count INT NOT NULL DEFAULT 0,
  top_intents JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (organization_id, channel_id, day)
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID,
  user_id UUID, api_key_id UUID,
  action TEXT NOT NULL,                      -- 'channel.connect', 'flow.publish'…
  resource TEXT, resource_id TEXT,
  ip INET, user_agent TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,             -- sha256 del secreto
  prefix TEXT NOT NULL,                      -- 'wsk_live_xxxx' visible
  scopes TEXT[] NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 3. Índices clave

```sql
-- Inbox: lista ordenada por actividad (la consulta más frecuente del producto)
CREATE INDEX idx_conversations_inbox ON conversations
  (organization_id, channel_id, status, last_message_at DESC);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at DESC);
-- Búsqueda full-text en mensajes
CREATE INDEX idx_messages_fts ON messages
  USING GIN (to_tsvector('spanish', coalesce(text,'')));
-- Contactos por IGSID (lookup en cada webhook)
CREATE INDEX idx_contacts_lookup ON contacts (channel_id, ig_scoped_id);
-- RAG: vecinos más cercanos filtrados por tenant
CREATE INDEX idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_org ON chunks (organization_id, source_id);
-- Timers de flujos (worker de despertar)
CREATE INDEX idx_flow_exec_wake ON flow_executions (wake_at)
  WHERE status = 'waiting_timer';
-- Renovación de tokens
CREATE INDEX idx_channels_expiring ON channels (token_expires_at)
  WHERE status = 'active' AND token_expires_at IS NOT NULL;
```

## 4. Row-Level Security (patrón)

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations
  USING (organization_id = current_setting('app.current_org_id')::uuid);
-- Se aplica el mismo patrón a todas las tablas tenant-scoped.
-- La app se conecta con un rol SIN BYPASSRLS; las migraciones con rol admin.
-- Cada request: BEGIN; SET LOCAL app.current_org_id = '<uuid>'; ...; COMMIT;
```

Nota de implementación con Prisma + PgBouncer: `SET LOCAL` exige transacción por request (interceptor `TenantTransaction`); pooling en modo *transaction* es compatible.

## 5. Migraciones y retención

- Migraciones: Prisma Migrate, versionadas en repo, aplicadas por CI/CD antes del deploy (estrategia expand→migrate→contract para cambios sin downtime).
- Particionado: `messages` y `flow_execution_steps` por rango mensual cuando el volumen lo exija (el diseño de índices ya lo permite).
- Retención: `webhook_events` 30 días; `audit_logs` 1 año; media en R2 según plan del tenant.
- Borrado de tenant (y Data Deletion de Meta): job que elimina en cascada por `organization_id` + purga de R2 y de claves Redis.
