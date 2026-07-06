"""Acceso a Postgres con asyncpg + pgvector, respetando el RLS multi-tenant.

El rol de la app NO es superusuario, así que toda consulta tenant-scoped debe
fijar `app.current_org_id` en la transacción (igual que PrismaService.withTenant
en NestJS). `tenant_conn(org_id)` y `system_conn()` encapsulan ese patrón.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from urllib.parse import urlparse

import asyncpg
from pgvector.asyncpg import register_vector

from app.config import get_settings

_pool: asyncpg.Pool | None = None


def _dsn_from_url(url: str) -> str:
    """Convierte la DATABASE_URL estilo Prisma a un DSN válido para asyncpg.

    Descarta parámetros que asyncpg no entiende (p. ej. ?schema=public).
    """
    parsed = urlparse(url)
    # asyncpg acepta postgresql://user:pass@host:port/db sin query string
    return f"postgresql://{parsed.netloc}{parsed.path}"


async def _init_conn(conn: asyncpg.Connection) -> None:
    await register_vector(conn)


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await asyncpg.create_pool(
            dsn=_dsn_from_url(settings.database_url),
            min_size=1,
            max_size=8,
            init=_init_conn,
            server_settings={"search_path": "public"},
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@contextlib.asynccontextmanager
async def tenant_conn(org_id: str) -> AsyncIterator[asyncpg.Connection]:
    """Conexión en una transacción con el tenant fijado para RLS."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', $1, true)", org_id)
            yield conn


@contextlib.asynccontextmanager
async def system_conn() -> AsyncIterator[asyncpg.Connection]:
    """Conexión en contexto de sistema (lecturas cross-tenant controladas)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.is_system', 'on', true)")
            yield conn


async def ping() -> bool:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        return True
    except Exception:
        return False
