from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración del servicio de IA (F3)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    port: int = 5000

    # Token compartido para llamadas internas api (NestJS) -> ai-service.
    internal_api_token: str | None = None

    # Base de datos (misma que la API; el rol es SIN superusuario, RLS activo).
    database_url: str = "postgresql://wolfiax:wolfiax_dev@localhost:5432/wolfiax"

    # Anthropic (LLM). Sin key el servicio arranca pero /reply y /analyze fallan
    # de forma controlada.
    anthropic_api_key: str | None = None
    llm_model: str = "claude-opus-4-8"
    llm_effort: str = "medium"  # low | medium | high | max

    # Embeddings locales (fastembed / ONNX). 1024 dims = multilingual-e5-large.
    embedding_model: str = "intfloat/multilingual-e5-large"
    embedding_dim: int = 1024

    # RAG
    rag_top_k: int = 8
    chunk_max_chars: int = 1600
    chunk_overlap_chars: int = 200


@lru_cache
def get_settings() -> Settings:
    return Settings()
