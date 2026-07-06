import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.api.v1 import router as v1_router
from app.config import get_settings
from app.db import close_pool, ping

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Precarga el modelo de embeddings en segundo plano (descarga ONNX la 1ª vez)
    from app.core import embeddings

    asyncio.get_event_loop().run_in_executor(None, embeddings.warmup)
    yield
    await close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="WOLFIAX SOCIAL AI — AI Service",
        version="0.3.0",
        docs_url="/docs" if settings.environment != "production" else None,
        lifespan=lifespan,
    )

    app.include_router(v1_router)

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        db_ok = await ping()
        return {
            "status": "ok" if db_ok else "degraded",
            "service": "ai-service",
            "version": "0.3.0",
            "db": "ok" if db_ok else "error",
            "llm_configured": bool(settings.anthropic_api_key),
        }

    return app


app = create_app()
