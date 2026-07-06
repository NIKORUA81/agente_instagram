"""Embeddings locales con fastembed (ONNX). Sin API key, datos del tenant nunca
salen del servidor. Modelo por defecto: intfloat/multilingual-e5-large (1024d),
fuerte en español. La abstracción permite cambiar a Voyage/OpenAI en el futuro
sin tocar el resto del código.

Los modelos e5 rinden mejor con prefijos "query:" (consulta) y "passage:"
(documento), por eso hay dos métodos.
"""

from __future__ import annotations

import asyncio
import threading

from app.config import get_settings

_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                _model = TextEmbedding(model_name=get_settings().embedding_model)
    return _model


def _embed_sync(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    return [vec.tolist() for vec in model.embed(texts)]


async def embed_passages(texts: list[str]) -> list[list[float]]:
    """Embeddings de fragmentos de conocimiento (para indexar)."""
    if not texts:
        return []
    prefixed = [f"passage: {t}" for t in texts]
    return await asyncio.to_thread(_embed_sync, prefixed)


async def embed_query(text: str) -> list[float]:
    """Embedding de una consulta del usuario (para recuperar)."""
    vecs = await asyncio.to_thread(_embed_sync, [f"query: {text}"])
    return vecs[0]


def warmup() -> None:
    """Carga el modelo (descarga si hace falta) al arrancar, fuera del camino
    crítico de la primera petición."""
    _get_model()
