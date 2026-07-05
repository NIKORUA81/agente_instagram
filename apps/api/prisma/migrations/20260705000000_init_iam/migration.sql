-- ============================================================================
-- F0 — IAM: organizaciones, usuarios, membresías, refresh tokens,
-- invitaciones, auditoría + Row-Level Security multi-tenant.
-- ============================================================================

CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'agent', 'analyst');

CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "full_name" TEXT NOT NULL,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resource_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE UNIQUE INDEX "invitations_organization_id_email_key" ON "invitations"("organization_id", "email");
CREATE INDEX "invitations_organization_id_idx" ON "invitations"("organization_id");
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ROW-LEVEL SECURITY
--
-- Contexto por transacción (lo fija PrismaService):
--   app.current_org_id  → UUID del tenant activo (peticiones autenticadas)
--   app.is_system = 'on' → solo para los casos de uso de IAM que legítimamente
--                          operan sin tenant (login, registro, refresh, aceptar
--                          invitación). Nunca se expone a controllers.
--
-- FORCE ROW LEVEL SECURITY hace que las políticas apliquen también al dueño
-- de la tabla (el rol de la app NO es superusuario; ver docker-compose.dev).
-- current_setting(..., true) devuelve NULL si la variable no está definida,
-- por lo que una conexión sin contexto no ve NINGUNA fila.
-- ============================================================================

-- organizations: visible si es el tenant activo o en contexto de sistema
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "organizations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "id" = current_setting('app.current_org_id', true)::uuid
    );

-- users: escritura solo en contexto de sistema; lectura además para usuarios
-- que comparten la organización activa (lista de miembros, invitaciones).
-- Las políticas permisivas se combinan con OR.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "users"
    USING (current_setting('app.is_system', true) = 'on');
CREATE POLICY "same_org_read" ON "users" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "memberships" m
            WHERE m."user_id" = "users"."id"
              AND m."organization_id" = current_setting('app.current_org_id', true)::uuid
        )
    );

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "refresh_tokens"
    USING (current_setting('app.is_system', true) = 'on');

-- Tablas tenant-scoped
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "memberships"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );

-- audit_logs: INSERT permitido en cualquier contexto autenticado del tenant;
-- lectura solo del propio tenant. Sin UPDATE/DELETE (inmutable por política:
-- no existe política para esos comandos, y RLS los deniega por defecto).
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_read" ON "audit_logs" FOR SELECT
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );
CREATE POLICY "tenant_insert" ON "audit_logs" FOR INSERT
    WITH CHECK (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = current_setting('app.current_org_id', true)::uuid
    );
