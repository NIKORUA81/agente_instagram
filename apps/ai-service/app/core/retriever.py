"""Recuperación de fragmentos relevantes desde pgvector (RAG), acotada al tenant
por RLS. Devuelve chunks ordenados por similitud coseno con un umbral mínimo.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import get_settings
from app.core import embeddings
from app.db import tenant_conn


@dataclass
class RetrievedChunk:
    content: str
    source_id: str
    similarity: float
    metadata: dict


async def retrieve(org_id: str, query: str, top_k: int | None = None) -> list[RetrievedChunk]:
    settings = get_settings()
    top_k = top_k or settings.rag_top_k

    query_vec = await embeddings.embed_query(query)

    async with tenant_conn(org_id) as conn:
        rows = await conn.fetch(
            """
            SELECT content, source_id, metadata,
                   1 - (embedding <=> $1) AS similarity
            FROM chunks
            WHERE organization_id = $2
            ORDER BY embedding <=> $1
            LIMIT $3
            """,
            query_vec,
            org_id,
            top_k,
        )

    import json

    return [
        RetrievedChunk(
            content=r["content"],
            source_id=str(r["source_id"]),
            similarity=float(r["similarity"]),
            metadata=r["metadata"] if isinstance(r["metadata"], dict) else json.loads(r["metadata"]),
        )
        for r in rows
    ]
