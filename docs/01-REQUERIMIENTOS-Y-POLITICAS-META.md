# 01 — Análisis de Requerimientos y Políticas de Meta

> Este documento es la base de cumplimiento del producto. Nada de lo que se construya puede contradecirlo.
> Nota: las políticas y versiones de la API de Meta cambian con frecuencia; antes de implementar cada fase se debe verificar contra la documentación vigente en developers.facebook.com.

## 1. Restricciones críticas de Meta (no negociables)

### 1.1 La ventana de 24 horas
La Instagram Messaging API opera bajo la **ventana estándar de mensajería de 24 horas**:

- Cuando un usuario envía un DM (o responde una historia, o reacciona), se abre una ventana de 24h en la que el negocio puede responder libremente (texto, media, plantillas).
- **Fuera de esa ventana no se puede iniciar contacto**, con una excepción principal: la etiqueta `HUMAN_AGENT`, que permite respuesta de un agente humano hasta **7 días** después del último mensaje del usuario (requiere aprobación en App Review y debe ser genuinamente humana, no automatizada).

**Consecuencia de diseño:** el producto es de **respuesta automatizada entrante**, no de outbound. El envío "masivo" solo es legítimo como *respuesta* a usuarios con ventana abierta (p. ej. responder a todos los que comentaron una palabra clave en una historia). La UI debe mostrar el estado de la ventana en cada conversación y bloquear envíos automáticos fuera de ella.

### 1.2 Prohibiciones absolutas
- Mensajes no solicitados (spam/cold DMs), compra o intercambio de datos de usuarios.
- Automatización que se haga pasar por humano sin revelarlo: las Políticas de Meta exigen **divulgar al usuario que interactúa con un bot** al inicio de la conversación y ofrecer vía de escalamiento a humano. Esto será una función del producto (mensaje de divulgación configurable, siempre activo).
- Retención/uso de datos de la plataforma fuera de los fines autorizados; hay que respetar solicitudes de borrado (callback de *Data Deletion Request* obligatorio en la app de Meta).

### 1.3 Requisitos de la cuenta conectada
- Cuenta de Instagram **profesional** (Business o Creator).
- El usuario debe activar en la app de Instagram: *Configuración → Mensajes → Permitir acceso a mensajes* (connected tools). El onboarding debe detectarlo y guiarlo.
- Meta entrega los mensajes por webhook **solo a la app**; los mensajes escritos manualmente desde la app de Instagram por el dueño también llegan como eventos `echo`.

## 2. Vías de conexión OAuth (decisión de producto)

Meta ofrece hoy dos vías oficiales para mensajería de Instagram:

| | A. Instagram API con **Facebook Login** | B. Instagram API con **Instagram Login** |
|---|---|---|
| Requiere Página de Facebook vinculada | Sí | **No** |
| Permisos | `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, `pages_show_list`, `business_management` (según caso) | `instagram_business_basic`, `instagram_business_manage_messages` |
| Token que se usa | Page Access Token (larga duración) | Instagram User Access Token (larga duración, ~60 días, renovable) |
| Fricción de onboarding | Alta (mucha gente no tiene página FB o no sabe cuál está vinculada) | Baja |

**Decisión:** implementar **ambas** detrás de una abstracción `MetaConnector`, con **Instagram Login como vía primaria** (menor fricción, no exige página de Facebook) y Facebook Login como alternativa (necesaria para funciones que dependan de la página o para cuentas ya gestionadas vía Business Manager). El modelo de datos guarda `connection_type` por canal.

## 3. Permisos y App Review

La app de Meta pasará por **App Review** y probablemente **Business Verification** (obligatoria para acceso avanzado). Checklist:

- Permisos a solicitar: los de la tabla anterior + `human_agent` (para la ventana de 7 días del inbox humano).
- Se necesita: video screencast del flujo, URL de política de privacidad, instrucciones de prueba, callback de borrado de datos.
- **Modo desarrollo:** antes del App Review, todo funciona con cuentas con rol en la app (admin/developer/tester). El plan de fases aprovecha esto: F1–F4 se desarrollan y prueban con cuentas propias; el App Review se tramita en paralelo a F3.

## 4. Webhooks oficiales

Suscripciones al objeto `instagram`: campos `messages`, `messaging_postbacks`, `messaging_seen`, `message_reactions`, `messaging_referral`. Cubren los disparadores pedidos:

| Requerimiento del cliente | Evento oficial |
|---|---|
| "Cuando llegue un DM" | `messages` |
| "Cuando escriba/mencione una palabra o emoji" | `messages` + matching en nuestro motor de reglas |
| "Cuando responda una historia" | `messages` con `reply_to.story` |
| "Cuando reaccione" | `message_reactions` |
| "Cuando sea cliente nuevo/recurrente" | derivado en nuestra BD (primer contacto vs. historial) |
| "Cuando compre / abandone" | eventos internos del CRM/integraciones, no de Meta |

Requisitos técnicos: endpoint HTTPS público, verificación `hub.challenge` (GET), validación de firma `X-Hub-Signature-256` (HMAC-SHA256 con app secret), **respuesta 200 en <5s** (nosotros: ACK inmediato + cola), tolerancia a reintentos/duplicados (idempotencia por `mid`).

## 5. Límites de tasa de Meta

- Mensajería IG: del orden de **cientos de llamadas por segundo por cuenta IG** (Conversations API ~2 cps para lectura de historial — por eso el historial se construye desde webhooks, no consultando la API).
- Graph API general: cuota por app y por usuario (BUC). El cliente HTTP hacia Meta llevará: rate limiter por cuenta, reintentos con backoff exponencial, circuit breaker y lectura de headers `X-Business-Use-Case-Usage`.

## 6. Requerimientos funcionales consolidados

RF-01 Conectar cuenta IG profesional vía OAuth (Instagram Login o Facebook Login), con selección de cuenta, validación de permisos, estado de conexión y renovación automática de tokens.
RF-02 Recibir DMs, story replies, reacciones y postbacks por webhook, en tiempo real, multi-tenant.
RF-03 Inbox: lista de conversaciones con historial, etiquetas, notas internas, estados (abierta / pendiente / resuelta / archivada), asignación a agente, búsqueda full-text.
RF-04 Motor IA: respuesta automática con RAG sobre la base de conocimiento del tenant; detección de intención, idioma y sentimiento; resumen; extracción de datos (nombre, teléfono, email, interés); sugerencia de respuestas al agente humano.
RF-05 Base de conocimiento por tenant: ingesta de PDF, DOCX, XLSX, URLs, FAQs manuales, catálogo de productos/servicios, políticas, horarios, promociones, manual de marca y tono.
RF-06 Flow builder visual con nodos: inicio, condición, pregunta, respuesta, IA, esperar, webhook saliente, llamada API, variable, etiqueta, transferir a humano, finalizar; con ramas y loops acotados.
RF-07 Motor de automatizaciones: disparador → condiciones → acciones, con prioridades y límites anti-loop.
RF-08 Handover a humano: pausa de la IA por conversación, notificación a agentes, modo `human_agent`.
RF-09 Envío de multimedia (imagen, audio, video, plantillas genéricas con botones) dentro de la ventana.
RF-10 Analítica: volumen, tiempos de respuesta, clientes nuevos/recurrentes, temas, resolución IA vs humano, satisfacción (CSAT post-conversación), uso de tokens IA.
RF-11 Multi-tenant: organizaciones con usuarios, roles (owner, admin, agente, analista), configuración, prompts y datos totalmente aislados.
RF-12 API pública REST + webhooks salientes para integración con CRMs.
RF-13 Auditoría: registro inmutable de acciones sensibles.

## 7. Requerimientos no funcionales

- RNF-01 ACK de webhook < 2s p99; primera respuesta automática < 5s p95.
- RNF-02 Escalable a miles de tenants: stateless en app, colas para picos, sharding lógico por tenant.
- RNF-03 Disponibilidad objetivo 99.5% en VPS (fase 1), 99.9% en Kubernetes (fase 2).
- RNF-04 Cifrado: TLS en tránsito, AES-256-GCM para tokens de Meta en reposo, backups cifrados.
- RNF-05 Observabilidad: logs estructurados, métricas, trazas, alertas.
- RNF-06 Cumplimiento GDPR-like: borrado por solicitud, minimización de datos, data deletion callback de Meta.
