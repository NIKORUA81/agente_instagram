from fastapi import Header, HTTPException, status

from app.config import get_settings


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """Protege los endpoints internos. NestJS envía X-Internal-Token.
    Si no hay token configurado (desarrollo), no se exige."""
    expected = get_settings().internal_api_token
    if not expected:
        return
    if x_internal_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token interno inválido.",
        )
