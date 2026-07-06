-- ============================================================================
-- F1 — Canales (conexión Meta), webhooks e inbox (contactos, conversaciones,
-- mensajes) + Row-Level Security multi-tenant.
-- ============================================================================

CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'instagram',
    "connection_type" TEXT NOT NULL,
    "ig_user_id" TEXT NOT NULL,
    "ig_username" TEXT NOT NULL,
    "fb_page_id" TEXT,
    "access_token_enc" BYTEA NOT NULL,
    "token_expires_at" TIMESTAMPTZ(6),
    "granted_scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_health_check_at" TIMESTAMPTZ(6),
    "webhook_subscribed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "channel_id" UUID,
    "external_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "ig_scoped_id" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "profile_pic_url" TEXT,
    "is_follower" BOOLEAN,
    "lifecycle" TEXT NOT NULL DEFAULT 'new',
    "extracted" JSONB NOT NULL DEFAULT '{}',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "mode" TEXT NOT NULL DEFAULT 'human',
    "assigned_user_id" UUID,
    "window_expires_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6),
    "last_inbound_at" TIMESTAMPTZ(6),
    "first_response_ms" INTEGER,
    "ai_summary" TEXT,
    "sentiment" TEXT,
    "language" TEXT,
    "intent" TEXT,
    "csat_score" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mid" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "reply_to_story" JSONB,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "sent_by_user_id" UUID,
    "ai_meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channels_ig_user_id_key" ON "channels"("ig_user_id");
CREATE INDEX "channels_organization_id_idx" ON "channels"("organization_id");
CREATE UNIQUE INDEX "webhook_events_external_id_event_type_key" ON "webhook_events"("external_id", "event_type");
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");
CREATE UNIQUE INDEX "contacts_channel_id_ig_scoped_id_key" ON "contacts"("channel_id", "ig_scoped_id");
CREATE INDEX "contacts_organization_id_idx" ON "contacts"("organization_id");
CREATE UNIQUE INDEX "conversations_channel_id_contact_id_key" ON "conversations"("channel_id", "contact_id");
CREATE INDEX "conversations_organization_id_channel_id_status_last_messa_idx"
    ON "conversations"("organization_id", "channel_id", "status", "last_message_at" DESC);
CREATE UNIQUE INDEX "messages_mid_key" ON "messages"("mid");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at" DESC);

ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_fkey"
    FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_fkey"
    FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ROW-LEVEL SECURITY (mismo modelo que la migración F0)
-- ============================================================================

ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channels" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "channels"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

-- webhook_events llega ANTES de conocer el tenant: solo contexto de sistema
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "webhook_events"
    USING (current_setting('app.is_system', true) = 'on');

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contacts"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "conversations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "messages"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );
