-- ============================================================================
-- F4 — Flow Builder: flujos, versiones inmutables y ejecuciones persistidas.
-- El grafo (JSON de React Flow) se interpreta como máquina de estados
-- persistida (ver docs/04-FLUJOS.md §3).
-- ============================================================================

CREATE TABLE "flows" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "trigger" JSONB NOT NULL DEFAULT '{"type":"manual"}',
    "graph" JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "published_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flow_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "flow_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "trigger" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flow_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "flow_id" UUID NOT NULL,
    "flow_version_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "current_node_id" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "trace" JSONB NOT NULL DEFAULT '[]',
    "steps" INTEGER NOT NULL DEFAULT 0,
    "wake_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "flow_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "flows_organization_id_enabled_idx" ON "flows"("organization_id", "enabled");
CREATE UNIQUE INDEX "flow_versions_flow_id_version_key" ON "flow_versions"("flow_id", "version");
CREATE INDEX "flow_versions_organization_id_idx" ON "flow_versions"("organization_id");
CREATE INDEX "flow_executions_conversation_id_status_idx" ON "flow_executions"("conversation_id", "status");
CREATE INDEX "flow_executions_organization_id_status_idx" ON "flow_executions"("organization_id", "status");

ALTER TABLE "flows" ADD CONSTRAINT "flows_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flows" ADD CONSTRAINT "flows_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_fkey"
    FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_flow_id_fkey"
    FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_flow_version_id_fkey"
    FOREIGN KEY ("flow_version_id") REFERENCES "flow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- ROW-LEVEL SECURITY (patrón con NULLIF, ver migración 20260709000000)
-- ============================================================================

ALTER TABLE "flows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flows" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "flows"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

ALTER TABLE "flow_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flow_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "flow_versions"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

ALTER TABLE "flow_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flow_executions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "flow_executions"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );
