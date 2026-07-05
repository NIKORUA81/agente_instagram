# 04 — Flujos de la Aplicación

## 1. Conexión de cuenta Instagram (Módulo 1)

```
Usuario (admin del tenant)                 WOLFIAX API                        Meta
      │  1. clic "Conectar Instagram"          │                               │
      │──────────────────────────────────────► │                               │
      │  2. redirect a URL OAuth (state=JWT    │                               │
      │◄────────────  firmado anti-CSRF) ──────│                               │
      │  3. login + consentimiento de permisos ────────────────────────────────►
      │  4. redirect a /callback?code=…&state=…                                │
      │──────────────────────────────────────► │ 5. valida state               │
      │                                        │ 6. code → short-lived token ──►
      │                                        │ 7. → long-lived token       ◄─│
      │                                        │ 8. GET cuentas IG disponibles ►
      │  9. UI: selecciona cuenta IG          ◄│                               │
      │──────────────────────────────────────► │ 10. cifra token (AES-GCM),    │
      │                                        │     guarda channel,           │
      │                                        │     suscribe webhooks ────────►
      │  11. checklist de salud:              ◄│ 12. health-check: token OK,   │
      │      cuenta profesional ✓              │     permisos ✓, "acceso a     │
      │      acceso a mensajes ✓ (guía si no)  │     mensajes" habilitado ✓    │
```

- **Renovación:** job diario busca `channels` con token que vence en <10 días → refresh → actualiza cifrado. Si falla: `status='token_expired'`, email + banner en dashboard.
- **Health-check horario:** llamada barata a Graph; ante `error 190` (token inválido) marca el canal y pausa automatizaciones.

## 2. Camino crítico: DM entrante → respuesta automática

```
Meta ─POST /webhooks/meta (firma X-Hub-Signature-256)
  │
  ▼
[webhook-ingest]  (objetivo < 200ms)
  1. verifica firma HMAC con app_secret          → 403 si inválida
  2. dedupe: INSERT webhook_events ON CONFLICT DO NOTHING (por mid)
  3. encola job en `inbound` con clave de grupo = ig_user_id+sender_id
  4. responde 200 OK
  │
  ▼
[worker inbound]
  5. resuelve channel → organization (contexto tenant)
  6. upsert contact (si nuevo: evento contact.created → trigger "cliente nuevo")
  7. upsert conversation: reabre si estaba resuelta, window_expires_at = now()+24h
  8. persiste message (idempotente por mid); si trae media → descarga a R2
  9. emite WS al inbox (agentes ven el mensaje en vivo)
 10. DECISIÓN DE ENRUTAMIENTO (en orden):
     a. conversation.mode = 'human'  → solo notificar agentes. FIN.
     b. hay flow_execution activa esperando input → reanudar flujo. FIN.
     c. motor de automatizaciones: evalúa triggers por prioridad
        (keyword, story_reply, reaction, new_contact…) con cooldown.
        Si una acción es start_flow/reply → ejecutar. FIN.
     d. ai_profile.enabled → encolar job `ai-reply`. FIN.
     e. nada aplica → conversación queda 'pending' para humanos.
  │
  ▼ (caso d)
[worker ai-reply] → ai-service /v1/reply
 11. guardrails pre: ventana 24h abierta, presupuesto de tokens,
     horario del negocio, límite de mensajes IA seguidos, keywords de handover
 12. RAG (ver §4) + LLM → respuesta + metadatos (intención, idioma, sentimiento,
     confianza, datos extraídos)
 13. confianza < umbral o intención sensible → handover (ver §5) en lugar de responder
 14. encola en `outbound`
  │
  ▼
[worker outbound]
 15. re-verifica ventana 24h (pudo expirar en cola) → aborta si cerró
 16. rate limiter por cuenta IG → POST /{ig_user_id}/messages
 17. persiste estado sent/failed (+reintentos con backoff; DLQ tras 5)
 18. actualiza métricas y emite WS
```

**Primera interacción con un contacto:** antes de la primera respuesta automatizada se antepone el `disclosure_message` ("Soy el asistente virtual de X…") — cumplimiento de políticas de Meta y buenas prácticas.

## 3. Ejecución de flujos (Módulo 4)

El grafo (JSON de React Flow) se interpreta como **máquina de estados persistida** (`flow_executions`), nunca en memoria:

- Nodos síncronos (condición, variable, etiqueta, respuesta) se ejecutan en cadena dentro del job.
- **Pregunta** → envía mensaje, `status='waiting_input'`, guarda `current_node_id`. El próximo mensaje del contacto reanuda ahí (validación de tipo: texto/número/email/opción).
- **Esperar** → `status='waiting_timer'`, `wake_at=…`; un delayed job de BullMQ lo despierta. **Regla de cumplimiento: al despertar se re-verifica la ventana de 24h; si está cerrada, el flujo termina en la rama "ventana cerrada" (nunca se envía).**
- **IA** → llama ai-service con el prompt del nodo + contexto; la salida puede rutear ramas (por intención) o rellenar variables.
- **Webhook/API** → llamada HTTP saliente con timeout 10s, reintentos, respuesta mapeada a variables (con sanitización).
- **Transferir** → conversation.mode='human', notifica, fin del flujo.
- Anti-loop: máximo de pasos por ejecución (configurable, default 200) y máximo de ejecuciones por contacto/día.
- Versionado: publicar crea `flow_version` inmutable; ejecuciones en curso terminan con su versión.

## 4. Pipeline RAG (Módulos 3 y 6)

**Ingesta** (worker `ingest`, vía ai-service):
```
fuente (PDF/DOCX/XLSX/URL/FAQ/catálogo)
  → parser específico (pypdf/unstructured, python-docx, openpyxl, crawler con
    respeto de robots.txt, formularios FAQ)
  → limpieza y normalización
  → chunking semántico (~500 tokens, overlap 50; filas de catálogo = 1 chunk/ítem)
  → embeddings (batch) → INSERT chunks (organization_id, metadata)
  → source.status = 'ready'
```

**Consulta** (por cada respuesta IA):
```
mensaje del usuario (+ últimos N turnos)
  → embedding de la consulta reescrita (query rewriting con historial)
  → pgvector: top-8 chunks WHERE organization_id = tenant (cosine, índice HNSW)
  → re-rank ligero + umbral de similitud
  → prompt = system (ai_profile: tono, idioma, guardrails, disclosure)
           + contexto del negocio (horarios, promos vigentes)
           + chunks citados
           + historial resumido de la conversación
  → LLM → JSON estructurado {reply, intent, language, sentiment, confidence,
                              extracted:{name,phone,email,interest}, handover:bool}
```

- Si no hay chunks relevantes por encima del umbral → respuesta honesta configurable ("déjame consultarlo con el equipo") + opción de handover automático. **La IA no inventa precios ni stock.**
- El resumen de conversación (`ai_summary`) se actualiza cada K mensajes de forma asíncrona para mantener contexto barato.

## 5. Handover a humano (Módulo 2/5)

Disparadores: keyword del usuario ("humano", "agente"), decisión de la IA (`handover:true`), baja confianza, sentimiento muy negativo, regla de automatización, o clic del agente.

```
handover → conversation.mode='human', status='pending'
         → notificación (WS + email/push según preferencias)
         → la IA queda silenciada en esa conversación
         → agente responde desde el inbox (dentro de 24h; con permiso human_agent
           aprobado, hasta 7 días marcando tag HUMAN_AGENT — solo respuestas humanas)
         → agente "devuelve a IA" o marca resuelta (opcional: encuesta CSAT 1-5)
```

## 6. Analítica (proyección de eventos)

Cada worker emite eventos de dominio (`message.received`, `ai.replied`, `handover`, `conversation.resolved`…) a la cola `analytics`; un worker los agrega en `analytics_daily` (UPSERT incremental). El dashboard lee solo tablas de proyección — nunca agrega sobre `messages` en caliente. Temas más consultados = agregación de `intent` + clustering ligero de embeddings de preguntas (job nocturno).
