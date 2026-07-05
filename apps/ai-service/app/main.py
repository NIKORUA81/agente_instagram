from fastapi import FastAPI

from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="WOLFIAX SOCIAL AI — AI Service",
        version="0.1.0",
        docs_url="/docs" if settings.environment != "production" else None,
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "ai-service", "version": "0.1.0"}

    return app


app = create_app()
