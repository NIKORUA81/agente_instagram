# WOLFIAX SOCIAL AI — Visión y Alcance

> Documento de diseño — Fase 0 (pre-código). Versión 0.1 — 2026-07-05
> Estado: **APROBADO**

## 1. Qué es

SaaS multi-tenant de Wolfiax para automatizar la atención de mensajes directos (DMs) de Instagram usando **exclusivamente APIs oficiales de Meta** (Instagram Messaging API, Graph API, OAuth 2.0, Webhooks oficiales). Sin scraping, sin Selenium, sin ingeniería inversa.

Cada empresa (tenant) conecta su cuenta profesional de Instagram, entrena una IA con el conocimiento de su negocio, y la plataforma responde DMs automáticamente, con escalamiento a humanos, flujos visuales, automatizaciones y analítica.

## 2. Principios rectores

1. **Cumplimiento primero.** Toda funcionalidad se diseña dentro de las políticas de la Plataforma de Meta. Si una función deseada viola políticas (p. ej. mensajes masivos no solicitados), se rediseña o se descarta. Ver [01-REQUERIMIENTOS-Y-POLITICAS-META.md](01-REQUERIMIENTOS-Y-POLITICAS-META.md).
2. **Multi-tenant desde el día 1.** Aislamiento de datos por organización en cada capa (BD, cache, colas, storage, IA).
3. **Empezar simple, escalar sin reescribir.** Monolito modular (NestJS) + servicio de IA (FastAPI), desplegado en VPS con Docker Compose; el diseño de módulos permite extraer microservicios y migrar a Kubernetes sin cambiar contratos.
4. **Todo asíncrono en el camino crítico.** Los webhooks de Meta se reconocen en <2s y el procesamiento (IA, flujos, reglas) ocurre en workers vía colas.
5. **La IA propone, las reglas gobiernan.** El motor de IA opera dentro de guardrails configurables por tenant (tono, temas prohibidos, escalamiento a humano).

## 3. Alcance del producto (MVP → completo)

| Módulo | Descripción | Fase |
|---|---|---|
| M1 Conexión Meta | OAuth, selección de cuenta IG, tokens, renovación, salud de conexión | F1 |
| M2 Inbox | Bandeja de conversaciones, historial, etiquetas, notas, estados, búsqueda | F1–F2 |
| M3 Motor IA | LLM + RAG: respuestas, intención, idioma, sentimiento, resumen, extracción | F3 |
| M4 Flow Builder | Constructor visual de flujos con bloques arrastrables (React Flow) | F4 |
| M5 Automatizaciones | Reglas disparador→condición→acción (keywords, story replies, reacciones…) | F2 |
| M6 IA Empresarial | Base de conocimiento por tenant (PDF, Word, Excel, web, FAQ, catálogos) | F3 |
| M7 Analítica | Dashboard de conversaciones, tiempos, temas, satisfacción, uso de IA | F5 |
| M8 Plataforma | Usuarios, roles, facturación, auditoría, límites por plan | F0, F6 |

## 4. Fuera de alcance (explícitamente)

- **DMs masivos no solicitados / cold outreach**: prohibido por políticas de Meta. Ver documento 01, sección "Restricciones críticas".
- Automatización de comentarios/likes/follows fuera de las APIs oficiales.
- Gestión de anuncios (posible integración futura vía Marketing API, no en este roadmap).
- WhatsApp y Messenger: la arquitectura de canal es agnóstica (interfaz `ChannelConnector`) para habilitarlos después, pero el MVP es solo Instagram.

## 5. Documentos de esta fase

| # | Documento | Contenido |
|---|---|---|
| 01 | [Requerimientos y Políticas Meta](01-REQUERIMIENTOS-Y-POLITICAS-META.md) | Análisis de requerimientos, restricciones de Meta, permisos, App Review |
| 02 | [Arquitectura](02-ARQUITECTURA.md) | Diagrama, componentes, decisiones técnicas justificadas, stack |
| 03 | [Modelo de Datos](03-MODELO-DE-DATOS.md) | ER, tablas, índices, RLS, migraciones |
| 04 | [Flujos de la Aplicación](04-FLUJOS.md) | OAuth, webhook→respuesta, ejecución de flujos, RAG, handover |
| 05 | [Diseño de API](05-API.md) | REST, auth, versionado, errores, rate limit, endpoints |
| 06 | [Estructura de Carpetas](06-ESTRUCTURA-DE-CARPETAS.md) | Monorepo, módulos backend, frontend, servicio IA |
| 07 | [Seguridad](07-SEGURIDAD.md) | OAuth, JWT, cifrado de tokens, RLS, OWASP, auditoría |
| 08 | [Despliegue](08-DESPLIEGUE.md) | Docker Compose (VPS), CI/CD, backups, ruta a Kubernetes |
| 09 | [Plan de Fases](09-PLAN-DE-FASES.md) | Roadmap F0–F7 con entregables y criterios de aceptación |
