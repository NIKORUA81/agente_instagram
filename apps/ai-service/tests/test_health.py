from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz() -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    # status puede ser "ok" o "degraded" según haya BD accesible en el entorno
    assert body["service"] == "ai-service"
    assert body["version"] == "0.3.0"
    assert "db" in body
