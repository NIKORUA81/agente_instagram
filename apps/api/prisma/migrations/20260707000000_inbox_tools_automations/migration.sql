-- ============================================================================
-- F2 — Etiquetas, notas, automatizaciones y búsqueda full-text.
-- ============================================================================

CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_tags" (
    "conversation_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("conversation_id", "tag_id")
);

CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel_id" UUID,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 60,
    "fire_count" BIGINT NOT NULL DEFAULT 0,
    "last_fired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tags_organization_id_name_key" ON "tags"("organization_id", "name");
CREATE INDEX "notes_conversation_id_idx" ON "notes"("conversation_id");
CREATE INDEX "automations_organization_id_enabled_priority_idx"
    ON "automations"("organization_id", "enabled", "priority");

-- Búsqueda full-text en mensajes (español)
CREATE INDEX "messages_text_fts_idx" ON "messages"
    USING GIN (to_tsvector('spanish', coalesce("text", '')));

ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automations" ADD CONSTRAINT "automations_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tags"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

ALTER TABLE "conversation_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "conversation_tags"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "notes"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "automations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );
