"""Ingesta de una fuente de conocimiento: parsear -> trocear -> embeddings ->
insertar chunks (acotado al tenant por RLS). Reemplaza los chunks previos de la
fuente para permitir re-procesos idempotentes.
"""

from __future__ import annotations

import base64
import json
import logging

from app.core import embeddings, parsers
from app.core.chunking import chunk_text
from app.db import tenant_conn
from app.schemas import IngestRequest, IngestResult

logger = logging.getLogger(__name__)


async def _extract_text(req: IngestRequest) -> str:
    if req.source_type == "url":
        if not req.url:
            raise ValueError("Falta la URL para una fuente de tipo 'url'.")
        return await parsers.parse_url(req.url)
    if req.text is not None:
        return req.text
    if req.content_base64 is not None:
        data = base64.b64decode(req.content_base64)
        return parsers.parse_bytes(req.source_type, data)
    raise ValueError("La fuente no trae ni texto, ni contenido, ni URL.")


async def ingest(req: IngestRequest) -> IngestResult:
    try:
        text = await _extract_text(req)
        chunks = chunk_text(text)
        if not chunks:
            await _finalize(req, status="ready", chunk_count=0)
            return IngestResult(status="ready", chunk_count=0)

        vectors = await embeddings.embed_passages(chunks)

        async with tenant_conn(req.organization_id) as conn:
            # Reemplazo idempotente
            await conn.execute("DELETE FROM chunks WHERE source_id = $1", req.source_id)
            await conn.executemany(
                """
                INSERT INTO chunks (id, organization_id, source_id, content, metadata, embedding)
                VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
                """,
                [
                    (
                        req.organization_id,
                        req.source_id,
                        content,
                        json.dumps({"source_name": req.name, "index": i}),
                        vector,
                    )
                    for i, (content, vector) in enumerate(zip(chunks, vectors, strict=True))
                ],
            )
            await conn.execute(
                """
                UPDATE knowledge_sources
                SET status = 'ready', chunk_count = $2, error = NULL, refreshed_at = now()
                WHERE id = $1
                """,
                req.source_id,
                len(chunks),
            )
        return IngestResult(status="ready", chunk_count=len(chunks))

    except Exception as exc:  # noqa: BLE001
        logger.exception("Fallo ingiriendo fuente %s", req.source_id)
        await _finalize(req, status="failed", error=str(exc)[:500])
        return IngestResult(status="failed", error=str(exc)[:500])


async def _finalize(
    req: IngestRequest, status: str, chunk_count: int = 0, error: str | None = None
) -> None:
    try:
        async with tenant_conn(req.organization_id) as conn:
            await conn.execute(
                """
                UPDATE knowledge_sources
                SET status = $2, chunk_count = $3, error = $4, refreshed_at = now()
                WHERE id = $1
                """,
                req.source_id,
                status,
                chunk_count,
                error,
            )
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo actualizar el estado de la fuente %s", req.source_id)
