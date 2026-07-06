"""Troceado de texto para RAG. Divide respetando límites de párrafo/oración
cuando es posible, con solapamiento para no perder contexto en los cortes.
"""

from __future__ import annotations

import re

from app.config import get_settings

_PARA = re.compile(r"\n\s*\n")


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?¿¡])\s+", text)
    return [p for p in parts if p.strip()]


def chunk_text(text: str, max_chars: int | None = None, overlap: int | None = None) -> list[str]:
    settings = get_settings()
    max_chars = max_chars or settings.chunk_max_chars
    overlap = overlap or settings.chunk_overlap_chars

    text = text.replace("\r\n", "\n").strip()
    if not text:
        return []

    # Unidades base: párrafos; los muy largos se parten por oraciones.
    units: list[str] = []
    for para in _PARA.split(text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chars:
            units.append(para)
        else:
            buf = ""
            for sent in _split_sentences(para):
                if len(buf) + len(sent) + 1 > max_chars and buf:
                    units.append(buf.strip())
                    buf = sent
                else:
                    buf = f"{buf} {sent}".strip()
            if buf:
                units.append(buf.strip())

    # Agrupa unidades hasta max_chars con solapamiento entre chunks.
    chunks: list[str] = []
    current = ""
    for unit in units:
        if len(current) + len(unit) + 1 > max_chars and current:
            chunks.append(current.strip())
            tail = current[-overlap:] if overlap else ""
            current = f"{tail} {unit}".strip()
        else:
            current = f"{current}\n\n{unit}".strip()
    if current.strip():
        chunks.append(current.strip())

    return chunks
