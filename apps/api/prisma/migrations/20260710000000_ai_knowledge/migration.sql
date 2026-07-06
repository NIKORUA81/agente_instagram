-- ============================================================================
-- F3 — Motor de IA y base de conocimiento (RAG).
-- Requiere la extensión pgvector (ya creada en el bootstrap de la BD).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ai_profiles: configuración de la IA por canal
CREATE TABLE "ai_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "system_prompt" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "language_policy" TEXT NOT NULL DEFAULT 'mirror',
    "disclosure_message" TEXT NOT NULL DEFAULT 'Hola, soy el asistente virtual del negocio. Con gusto te ayudo.',
    "handover_keywords" TEXT[] NOT NULL DEFAULT ARRAY['humano','agente','persona','asesor'],
    "guardrails" JSONB NOT NULL DEFAULT '{}',
    "business_hours" JSONB,
    "monthly_token_budget" BIGINT,
    "tokens_used_month" BIGINT NOT NULL DEFAULT 0,
    "confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "r2_key" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "refreshed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1024) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "media" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_profiles_channel_id_key" ON "ai_profiles"("channel_id");
CREATE INDEX "knowledge_sources_organization_id_idx" ON "knowledge_sources"("organization_id");
CREATE INDEX "chunks_organization_id_source_id_idx" ON "chunks"("organization_id", "source_id");
-- Índice HNSW para búsqueda de vecinos por coseno (RAG)
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks"
    USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "catalog_items_organization_id_idx" ON "catalog_items"("organization_id");

ALTER TABLE "ai_profiles" ADD CONSTRAINT "ai_profiles_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_profiles" ADD CONSTRAINT "ai_profiles_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- ROW-LEVEL SECURITY (patrón con NULLIF, ver migración 20260709000000)
-- ============================================================================

ALTER TABLE "ai_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_profiles"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "knowledge_sources"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "chunks"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "catalog_items"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );
