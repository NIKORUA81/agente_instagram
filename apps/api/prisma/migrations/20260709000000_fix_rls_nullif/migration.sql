-- ============================================================================
-- FIX RLS: envolver current_setting('app.current_org_id') en NULLIF(...,'').
--
-- En una conexión del pool que ya atendió una petición con tenant, el GUC
-- `app.current_org_id` queda "conocido pero vacío" ('') tras el reset del
-- SET LOCAL, en vez de NULL. El cast ''::uuid lanza 22P02
-- ("invalid input syntax for type uuid"). NULLIF(...,'') lo convierte en NULL
-- y la política evalúa sin error. Idempotente (DROP ... IF EXISTS).
-- ============================================================================

-- organizations
DROP POLICY IF EXISTS "tenant_isolation" ON "organizations";
CREATE POLICY "tenant_isolation" ON "organizations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- users (lectura de miembros de la org activa)
DROP POLICY IF EXISTS "same_org_read" ON "users";
CREATE POLICY "same_org_read" ON "users" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "memberships" m
            WHERE m."user_id" = "users"."id"
              AND m."organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        )
    );

-- memberships
DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- invitations
DROP POLICY IF EXISTS "tenant_isolation" ON "invitations";
CREATE POLICY "tenant_isolation" ON "invitations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- audit_logs (lectura e inserción)
DROP POLICY IF EXISTS "tenant_read" ON "audit_logs";
CREATE POLICY "tenant_read" ON "audit_logs" FOR SELECT
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );
DROP POLICY IF EXISTS "tenant_insert" ON "audit_logs";
CREATE POLICY "tenant_insert" ON "audit_logs" FOR INSERT
    WITH CHECK (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- channels
DROP POLICY IF EXISTS "tenant_isolation" ON "channels";
CREATE POLICY "tenant_isolation" ON "channels"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- contacts
DROP POLICY IF EXISTS "tenant_isolation" ON "contacts";
CREATE POLICY "tenant_isolation" ON "contacts"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- conversations
DROP POLICY IF EXISTS "tenant_isolation" ON "conversations";
CREATE POLICY "tenant_isolation" ON "conversations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- messages
DROP POLICY IF EXISTS "tenant_isolation" ON "messages";
CREATE POLICY "tenant_isolation" ON "messages"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- tags
DROP POLICY IF EXISTS "tenant_isolation" ON "tags";
CREATE POLICY "tenant_isolation" ON "tags"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- conversation_tags
DROP POLICY IF EXISTS "tenant_isolation" ON "conversation_tags";
CREATE POLICY "tenant_isolation" ON "conversation_tags"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- notes
DROP POLICY IF EXISTS "tenant_isolation" ON "notes";
CREATE POLICY "tenant_isolation" ON "notes"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );

-- automations
DROP POLICY IF EXISTS "tenant_isolation" ON "automations";
CREATE POLICY "tenant_isolation" ON "automations"
    USING (
        current_setting('app.is_system', true) = 'on'
        OR "organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    );
