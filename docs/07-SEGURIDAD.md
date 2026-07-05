# 07 — Seguridad

## 1. Identidad y acceso

- **Usuarios dashboard:** email+password (Argon2id) con MFA TOTP opcional (obligatorio para owners en planes altos). JWT access 15 min (RS256, claims mínimos: `sub`, `org`, `role`) + refresh 30 días **rotado en cada uso** con detección de reuso por familia (`refresh_tokens.family_id`): si un refresh revocado se reusa → se revoca toda la familia (robo de token).
- Web: refresh en cookie `httpOnly; Secure; SameSite=Strict` → CSRF mitigado por SameSite + verificación de `Origin` en mutaciones; el access token vive solo en memoria del cliente (nunca localStorage).
- **RBAC:** roles por membership — `owner` (todo + billing + borrar org), `admin` (todo menos billing/borrado), `agent` (inbox, contactos), `analyst` (solo lectura + analítica). Guard de Nest `@Roles()` + verificación a nivel de caso de uso (defensa en profundidad).
- **API pública:** keys `wsk_live_…` mostradas una sola vez, almacenadas como SHA-256, con scopes y revocación.

## 2. Aislamiento multi-tenant (la amenaza nº 1 de un SaaS)

Tres capas independientes:
1. **Aplicación:** `TenantGuard` extrae `org` del JWT; ningún endpoint acepta `organization_id` del cliente.
2. **Base de datos:** RLS activo en toda tabla tenant-scoped; la app se conecta con rol sin `BYPASSRLS`; `SET LOCAL app.current_org_id` por transacción (interceptor). Un `WHERE` olvidado devuelve 0 filas, no datos ajenos.
3. **Pruebas:** suite de integración específica de cross-tenant (usuario de org A intenta cada endpoint con IDs de org B → siempre 404).

## 3. Cifrado y secretos

- **Tokens de Meta (el activo más sensible):** AES-256-GCM con envelope encryption — una *data key* por organización, cifrada por la *master key* (env/KMS). Rotación de master key sin re-cifrar todo (solo re-cifra data keys). Los tokens **jamás** aparecen en logs, respuestas de API ni mensajes de error.
- TLS 1.2+ en todo; HSTS; certificados via Let's Encrypt (Traefik/NGINX).
- Secretos de runtime: `.env` fuera del repo (fase VPS con SOPS para versionarlos cifrados) → External Secrets en K8s. `APP_SECRET` de Meta solo en el servicio de webhooks y OAuth.
- Backups cifrados (age/GPG) antes de subir a R2.

## 4. OWASP Top 10 — controles concretos

| Riesgo | Control |
|---|---|
| Injection (SQL) | Prisma/SQLAlchemy parametrizado; nunca SQL concatenado; validación DTO previa |
| XSS | React escapa por defecto; CSP estricta (`default-src 'self'`); sanitización del contenido de mensajes de IG al renderizar (texto plano, nunca `dangerouslySetInnerHTML`); sanitización de respuestas de nodos API antes de interpolar en mensajes |
| CSRF | SameSite=Strict + verificación Origin + tokens de estado firmados en OAuth |
| SSRF | El nodo Webhook/API del flow builder valida URL: bloquea IPs privadas/link-local/metadata (resolución DNS previa + allowlist de esquemas https), timeout y tamaño máximo de respuesta |
| Broken Auth | Rotación de refresh, rate limit en /auth (10/min), lockout progresivo, MFA |
| Broken Access Control | RBAC + RLS + suite cross-tenant |
| Componentes vulnerables | Dependabot + `pnpm audit`/`pip-audit` en CI, imágenes base actualizadas |
| SSRF/RCE en parsers | Ingesta de documentos en workers aislados (contenedor sin credenciales de BD principal, solo cola y R2), límites de tamaño (25 MB) y tipo MIME verificado |
| Rate limiting | Por IP (proxy), por usuario, por API key, por tenant hacia Meta |
| Logging/Monitoring | Ver §6 |

## 5. Seguridad específica de Meta

- Verificación **obligatoria** de `X-Hub-Signature-256` (HMAC con app secret, comparación en tiempo constante) antes de parsear cualquier webhook; 403 y alerta ante firmas inválidas repetidas.
- `state` de OAuth: JWT firmado de un solo uso con expiración 10 min (anti-CSRF del flujo de conexión).
- Data Deletion Callback implementado (requisito de Meta): borra datos del usuario final que lo solicite.
- Principio de mínimo privilegio en scopes: solo los permisos listados en doc 01.

## 6. Auditoría y monitoreo de seguridad

- `audit_logs` inmutable (INSERT-only, sin UPDATE/DELETE para el rol de la app) para: login, cambios de rol, conexión/desconexión de canal, publicación de flujos, cambios de ai_profile, exports, gestión de API keys.
- Logs estructurados (pino) con `request_id` y `org_id`, **con redacción automática** de tokens, emails y teléfonos.
- Alertas: picos de 401/403, firmas de webhook inválidas, reuso de refresh tokens, errores 190 de Meta (tokens revocados), consumo anómalo de tokens IA por tenant.
- Sentry para excepciones (con scrubbing de PII).

## 7. Privacidad

- Minimización: solo se almacena lo necesario para operar el inbox y la IA.
- Retención configurable por tenant; borrado de org = purga completa (BD, R2, Redis, vectores).
- Los datos de un tenant **nunca** se usan para entrenar modelos ni cruzan a otro tenant (el RAG filtra por `organization_id` en la misma query del índice).
- DPA disponible para clientes; PII cifrada en backups.
