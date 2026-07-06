-- ============================================================================
-- Super Admin (staff Wolfiax): suspensión de organizaciones.
-- Una org suspendida no puede iniciar sesión ni operar, pero conserva sus datos.
-- ============================================================================

ALTER TABLE "organizations" ADD COLUMN "suspended_at" TIMESTAMPTZ(6);
