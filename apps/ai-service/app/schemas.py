from __future__ import annotations

from pydantic import BaseModel, Field


# --- Ingesta ---------------------------------------------------------------


class IngestRequest(BaseModel):
    organization_id: str
    source_id: str
    source_type: str  # pdf | docx | xlsx | url | text | faq | policy | catalog
    name: str
    # Contenido: base64 (documentos) o texto plano; o una URL para type=url
    content_base64: str | None = None
    text: str | None = None
    url: str | None = None


class IngestResult(BaseModel):
    status: str  # ready | failed
    chunk_count: int = 0
    error: str | None = None


# --- Reply (RAG + LLM) -----------------------------------------------------


class HistoryTurn(BaseModel):
    role: str  # user | assistant
    text: str


class AiProfileInput(BaseModel):
    system_prompt: str = ""
    tone: str = "professional"
    language_policy: str = "mirror"
    disclosure_message: str = ""
    confidence_threshold: float = 0.35
    business_hours: dict | None = None
    guardrails: dict = Field(default_factory=dict)
    handover_keywords: list[str] = Field(default_factory=list)


class ReplyRequest(BaseModel):
    organization_id: str
    profile: AiProfileInput
    message: str
    history: list[HistoryTurn] = Field(default_factory=list)
    contact_name: str | None = None
    # Si el negocio nunca ha enviado el aviso de bot en esta conversación
    include_disclosure: bool = False


class ExtractedData(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    interest: str | None = None


class ReplyResult(BaseModel):
    reply: str | None
    handover: bool
    intent: str | None = None
    language: str | None = None
    sentiment: str | None = None
    confidence: float = 0.0
    extracted: ExtractedData = Field(default_factory=ExtractedData)
    used_sources: list[str] = Field(default_factory=list)
    reason: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0


# --- Análisis --------------------------------------------------------------


class AnalyzeRequest(BaseModel):
    organization_id: str
    history: list[HistoryTurn] = Field(default_factory=list)
    message: str | None = None


class AnalyzeResult(BaseModel):
    intent: str | None = None
    language: str | None = None
    sentiment: str | None = None
    summary: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0


# --- Búsqueda de conocimiento (debug del RAG) ------------------------------


class SearchRequest(BaseModel):
    organization_id: str
    query: str
    top_k: int = 8


class SearchHit(BaseModel):
    content: str
    source_id: str
    similarity: float


class SearchResult(BaseModel):
    hits: list[SearchHit]
