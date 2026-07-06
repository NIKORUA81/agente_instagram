"""Análisis de conversación: intención, idioma, sentimiento y resumen.
Un único llamado al LLM que devuelve JSON."""

from __future__ import annotations

import logging

from app.core import llm
from app.schemas import AnalyzeRequest, AnalyzeResult

logger = logging.getLogger(__name__)

_SYSTEM = (
    "Eres un analista de conversaciones de atención al cliente. Analiza el diálogo "
    "y devuelve EXCLUSIVAMENTE un objeto JSON con esta forma:\n"
    '{"intent": string (intención principal del cliente, en minúsculas y con guion_bajo), '
    '"language": string (código ISO, p. ej. "es"), '
    '"sentiment": "positive"|"neutral"|"negative", '
    '"summary": string (resumen de 1-2 frases del estado de la conversación)}'
)


async def analyze(req: AnalyzeRequest) -> AnalyzeResult:
    lines: list[str] = []
    for turn in req.history[-12:]:
        who = "Cliente" if turn.role == "user" else "Asistente"
        lines.append(f"{who}: {turn.text}")
    if req.message:
        lines.append(f"Cliente: {req.message}")
    convo = "\n".join(lines) or (req.message or "")

    result = await llm.chat(_SYSTEM, f"Conversación:\n{convo}", max_tokens=400)
    try:
        data = llm.parse_json_object(result.text)
    except Exception:  # noqa: BLE001
        logger.warning("Análisis no-JSON; se devuelve vacío.")
        data = {}

    return AnalyzeResult(
        intent=data.get("intent"),
        language=data.get("language"),
        sentiment=data.get("sentiment"),
        summary=data.get("summary"),
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )
