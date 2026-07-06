"""Proveedor de LLM: Anthropic Claude (claude-opus-4-8) vía el SDK oficial.

Abstracción mínima para que el resto del código no dependa del SDK. Se omite el
parámetro `thinking` a propósito: en Opus 4.8 omitirlo corre sin extended
thinking, lo que reduce latencia en respuestas de DM (objetivo <5s p95). El
`effort` (config) ajusta profundidad/coste sin activar thinking.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.config import get_settings


class LlmUnavailable(RuntimeError):
    """Se lanza cuando no hay ANTHROPIC_API_KEY configurada."""


@dataclass
class LlmResult:
    text: str
    input_tokens: int
    output_tokens: int


_client = None


def _get_client():
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.anthropic_api_key:
            raise LlmUnavailable(
                "ANTHROPIC_API_KEY no está configurada en el ai-service."
            )
        from anthropic import AsyncAnthropic

        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def chat(system: str, user: str, max_tokens: int = 1024) -> LlmResult:
    settings = get_settings()
    client = _get_client()
    resp = await client.messages.create(
        model=settings.llm_model,
        max_tokens=max_tokens,
        output_config={"effort": settings.llm_effort},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = "".join(block.text for block in resp.content if block.type == "text")
    return LlmResult(
        text=text.strip(),
        input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
    )


def parse_json_object(raw: str) -> dict:
    """Extrae el primer objeto JSON del texto del modelo (tolerante a envoltura)."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("La respuesta del modelo no contiene un objeto JSON.")
    return json.loads(raw[start : end + 1])
