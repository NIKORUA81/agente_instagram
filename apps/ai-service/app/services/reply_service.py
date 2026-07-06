"""Genera una respuesta automática con RAG + guardrails.

Reglas clave (criterio de aceptación F3):
  - La IA responde usando SOLO la base de conocimiento del tenant.
  - Si no hay contexto relevante o la confianza es baja -> handover a humano
    (no inventa precios ni stock).
  - Detecta intención/idioma/sentimiento y extrae datos del contacto.
La validación de la ventana de 24h y el envío ocurren en NestJS, no aquí.
"""

from __future__ import annotations

import logging

from app.core import llm
from app.core.retriever import RetrievedChunk, retrieve
from app.schemas import ExtractedData, ReplyRequest, ReplyResult

logger = logging.getLogger(__name__)

# Umbral de similitud por debajo del cual el contexto se considera irrelevante.
MIN_SIMILARITY = 0.30


def _normalize(text: str) -> str:
    import unicodedata

    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.lower()


def _matches_handover_keyword(message: str, keywords: list[str]) -> bool:
    haystack = _normalize(message)
    return any(_normalize(k) in haystack for k in keywords if k.strip())


def _build_system(req: ReplyRequest, chunks: list[RetrievedChunk]) -> str:
    p = req.profile
    tone_map = {
        "professional": "profesional y cordial",
        "friendly": "cercano y amable",
        "casual": "relajado y coloquial",
    }
    tone = tone_map.get(p.tone, p.tone)

    lang_rule = (
        "Responde en el MISMO idioma que use el cliente."
        if p.language_policy == "mirror"
        else f"Responde SIEMPRE en el idioma: {p.language_policy.replace('fixed:', '')}."
    )

    guardrails = p.guardrails or {}
    forbidden = guardrails.get("forbidden_topics") or []
    max_chars = guardrails.get("max_reply_chars", 600)

    context = "\n\n---\n".join(c.content for c in chunks) if chunks else "(sin información relevante)"

    parts = [
        f"Eres el asistente virtual de atención al cliente de un negocio en Instagram. Tu tono es {tone}.",
        p.system_prompt.strip() if p.system_prompt.strip() else "",
        lang_rule,
        "Usa EXCLUSIVAMENTE la información del CONTEXTO para responder sobre el negocio "
        "(productos, precios, horarios, políticas). NUNCA inventes precios, stock, "
        "promociones ni datos que no estén en el contexto.",
        "Si el contexto no contiene la respuesta, NO la inventes: marca handover=true "
        "y ofrece derivar con una persona del equipo.",
        f"Mantén la respuesta breve (máximo ~{max_chars} caracteres), natural para un DM.",
    ]
    if forbidden:
        parts.append(f"No trates estos temas; si surgen, deriva a un humano: {', '.join(forbidden)}.")
    if p.business_hours:
        parts.append(f"Horario de atención del negocio (para referencia): {p.business_hours}.")

    parts.append(
        "Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta forma exacta:\n"
        '{"reply": string, "intent": string, "language": string (código ISO como "es"), '
        '"sentiment": "positive"|"neutral"|"negative", "confidence": number entre 0 y 1, '
        '"extracted": {"name": string|null, "phone": string|null, "email": string|null, "interest": string|null}, '
        '"handover": boolean, "reason": string}\n'
        "confidence refleja cuán respaldada por el contexto está tu respuesta.\n\n"
        f"CONTEXTO DEL NEGOCIO:\n{context}"
    )
    return "\n\n".join(x for x in parts if x)


def _build_user(req: ReplyRequest) -> str:
    lines = []
    if req.history:
        lines.append("Historial reciente de la conversación:")
        for turn in req.history[-8:]:
            who = "Cliente" if turn.role == "user" else "Asistente"
            lines.append(f"{who}: {turn.text}")
        lines.append("")
    who = f" ({req.contact_name})" if req.contact_name else ""
    lines.append(f"Nuevo mensaje del cliente{who}: {req.message}")
    return "\n".join(lines)


async def generate_reply(req: ReplyRequest) -> ReplyResult:
    # 1. Handover explícito por palabra clave (sin gastar tokens de LLM)
    if _matches_handover_keyword(req.message, req.profile.handover_keywords):
        return ReplyResult(
            reply=None,
            handover=True,
            intent="request_human",
            reason="El cliente pidió hablar con una persona.",
        )

    # 2. Recuperación RAG
    chunks = await retrieve(req.organization_id, req.message)
    best_sim = max((c.similarity for c in chunks), default=0.0)
    relevant = [c for c in chunks if c.similarity >= MIN_SIMILARITY]

    # 3. Generación
    system = _build_system(req, relevant or chunks[:3])
    user = _build_user(req)
    result = await llm.chat(system, user, max_tokens=900)

    try:
        data = llm.parse_json_object(result.text)
    except Exception:  # noqa: BLE001
        logger.warning("Respuesta no-JSON del modelo; se deriva a humano por seguridad.")
        return ReplyResult(
            reply=None,
            handover=True,
            reason="No se pudo generar una respuesta confiable.",
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )

    confidence = float(data.get("confidence") or 0.0)
    handover = bool(data.get("handover")) or confidence < req.profile.confidence_threshold
    # Sin contexto relevante y sin que el modelo lo marque -> derivar igual
    if not relevant and best_sim < MIN_SIMILARITY:
        handover = True

    extracted_raw = data.get("extracted") or {}
    extracted = ExtractedData(
        name=extracted_raw.get("name"),
        phone=extracted_raw.get("phone"),
        email=extracted_raw.get("email"),
        interest=extracted_raw.get("interest"),
    )

    reply_text = (data.get("reply") or "").strip() or None
    if handover:
        reply_text = None  # el envío de la respuesta lo decide NestJS; en handover no se responde

    # Aviso de bot en la primera interacción
    if reply_text and req.include_disclosure and req.profile.disclosure_message.strip():
        reply_text = f"{req.profile.disclosure_message.strip()}\n\n{reply_text}"

    return ReplyResult(
        reply=reply_text,
        handover=handover,
        intent=data.get("intent"),
        language=data.get("language"),
        sentiment=data.get("sentiment"),
        confidence=confidence,
        extracted=extracted,
        used_sources=list({c.source_id for c in relevant}),
        reason=data.get("reason") if handover else None,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )
