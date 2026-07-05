from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración del servicio de IA (F0: mínima; crece en F3)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    port: int = 5000
    # Token compartido para llamadas internas api -> ai-service (se define en F3;
    # en F0 el servicio no expone lógica de negocio).
    internal_api_token: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
