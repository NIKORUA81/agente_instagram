from fastapi import APIRouter, Depends, HTTPException, status

from app.core.llm import LlmUnavailable
from app.core.retriever import retrieve
from app.deps import require_internal_token
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResult,
    IngestRequest,
    IngestResult,
    ReplyRequest,
    ReplyResult,
    SearchHit,
    SearchRequest,
    SearchResult,
)
from app.services import analyze_service, ingest_service, reply_service

router = APIRouter(prefix="/v1", dependencies=[Depends(require_internal_token)])


@router.post("/reply", response_model=ReplyResult)
async def reply(req: ReplyRequest) -> ReplyResult:
    try:
        return await reply_service.generate_reply(req)
    except LlmUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


@router.post("/analyze", response_model=AnalyzeResult)
async def analyze(req: AnalyzeRequest) -> AnalyzeResult:
    try:
        return await analyze_service.analyze(req)
    except LlmUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


@router.post("/ingest", response_model=IngestResult)
async def ingest(req: IngestRequest) -> IngestResult:
    return await ingest_service.ingest(req)


@router.post("/search", response_model=SearchResult)
async def search(req: SearchRequest) -> SearchResult:
    chunks = await retrieve(req.organization_id, req.query, req.top_k)
    return SearchResult(
        hits=[
            SearchHit(content=c.content, source_id=c.source_id, similarity=c.similarity)
            for c in chunks
        ]
    )
