# 09 — Plan de Fases de Desarrollo

Cada fase termina con entregables verificables y **requiere tu aprobación antes de pasar a la siguiente**. El código de cada fase se entrega completo, listo para producción, con pruebas.

## F0 — Fundaciones (1ª fase de código)
**Entregables:**
- Monorepo (pnpm + Turborepo) con `apps/web`, `apps/api`, `apps/ai-service`, `packages/shared`.
- Docker Compose de desarrollo (Postgres+pgvector, Redis, servicios) y de producción base.
- NestJS: config tipada, Prisma + migración inicial (IAM completo), módulo `iam`: registro, login, JWT+refresh rotado, organizaciones, invitaciones, roles, guards de tenant y rol, RLS activo.
- Next.js: layout del dashboard, auth (login/registro/invitación), gestión de equipo.
- CI (lint, typecheck, tests) + deploy a staging en el VPS.
- Requisito externo en paralelo: **crear la app en Meta for Developers** (modo desarrollo) y cuenta IG profesional de prueba.

**Criterio de aceptación:** dos organizaciones con usuarios propios, aisladas (suite cross-tenant en verde), desplegado en VPS con HTTPS.

## F1 — Conexión Meta + recepción de mensajes
- Módulo `channels`: OAuth (Instagram Login + Facebook Login), selección de cuenta, cifrado de tokens, renovación automática, health-check, checklist de onboarding ("permitir acceso a mensajes").
- Módulo `webhooks`: verificación de firma, dedupe, colas BullMQ.
- Módulo `inbox` (lectura): contactos, conversaciones, mensajes en tiempo real (WS), ventana 24h visible.
- **Criterio:** un DM real a la cuenta de prueba aparece en el inbox en <2s.

## F2 — Inbox completo + automatizaciones básicas
- Envío como agente (texto y media), estados, asignación, etiquetas, notas, búsqueda, archivado.
- Motor de automatizaciones: keyword/emoji/story reply/reacción/cliente nuevo → responder/etiquetar/asignar, con cooldowns.
- **Criterio:** "si el DM contiene 'precio' → responde plantilla y etiqueta 'ventas'" funcionando end-to-end.

## F3 — Motor de IA + base de conocimiento (RAG)
- ai-service completo: ingesta PDF/DOCX/XLSX/URL/FAQ/catálogo, chunking, embeddings, retrieval con pgvector, respuesta con guardrails, intención/idioma/sentimiento/extracción, resúmenes.
- ai_profile por canal (tono, disclosure, handover, horarios, presupuesto de tokens), sandbox de prueba.
- Handover a humano completo.
- En paralelo: **solicitud de App Review** a Meta (permisos + human_agent) — para entonces hay producto demostrable para el screencast.
- **Criterio:** la IA responde preguntas del negocio usando solo la KB del tenant, escala a humano cuando corresponde y nunca responde fuera de la ventana de 24h.

## F4 — Flow Builder
- Editor React Flow (nodos: inicio, condición, pregunta, respuesta, IA, esperar, webhook, API, variable, etiqueta, transferir, finalizar), validación de grafo, versionado, sandbox de simulación.
- Motor de ejecución persistente (state machine + timers BullMQ).
- **Criterio:** flujo "bienvenida → pregunta → rama por respuesta → IA → transferir" ejecutándose con usuarios reales, con traza visual de ejecución.

## F5 — Analítica
- Proyecciones de eventos, dashboard completo (KPIs del requerimiento), CSAT post-conversación, temas más consultados, exports.

## F6 — Comercialización y endurecimiento
- Billing (Stripe): planes, límites por plan (canales, mensajes IA/mes, miembros), medición de uso.
- API pública con API keys + webhooks salientes (integración CRM), docs públicas.
- Auditoría completa, MFA, data deletion callback, pruebas de carga, hardening final.

## F7 — Kubernetes (cuando el negocio lo pida)
- Helm charts, ArgoCD, Postgres/Redis gestionados, KEDA para workers, réplica de lectura para analítica.

---

### Dependencias externas que conviene iniciar YA (no bloquean F0 pero sí F3+)
1. Crear app en Meta for Developers + Business Verification de Wolfiax (la verificación puede tardar semanas).
2. Dominio y subdominios (`app.`, `api.`) con DNS en Cloudflare.
3. Cuenta IG profesional + página FB de prueba.
4. VPS y cuenta Cloudflare R2.
5. Claves de API del proveedor LLM.
