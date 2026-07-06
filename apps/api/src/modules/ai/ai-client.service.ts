import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@wolfiax/shared';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/configuration';

/** Payload de /v1/reply del ai-service. */
export interface AiReplyRequest {
  organization_id: string;
  profile: {
    system_prompt: string;
    tone: string;
    language_policy: string;
    disclosure_message: string;
    confidence_threshold: number;
    business_hours: unknown;
    guardrails: unknown;
    handover_keywords: string[];
  };
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  contact_name?: string | null;
  include_disclosure: boolean;
}

export interface AiReplyResponse {
  reply: string | null;
  handover: boolean;
  intent: string | null;
  language: string | null;
  sentiment: string | null;
  confidence: number;
  extracted: { name?: string; phone?: string; email?: string; interest?: string };
  used_sources: string[];
  reason: string | null;
  input_tokens: number;
  output_tokens: number;
}

export interface AiIngestRequest {
  organization_id: string;
  source_id: string;
  source_type: string;
  name: string;
  content_base64?: string;
  text?: string;
  url?: string;
}

/** Cliente HTTP hacia el ai-service (FastAPI). */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('AI_SERVICE_URL', { infer: true }).replace(/\/$/, '');
    this.token = config.get('AI_SERVICE_TOKEN', { infer: true });
  }

  reply(payload: AiReplyRequest): Promise<AiReplyResponse> {
    return this.post<AiReplyResponse>('/v1/reply', payload, 30_000);
  }

  ingest(payload: AiIngestRequest): Promise<{ status: string; chunk_count: number; error?: string }> {
    return this.post('/v1/ingest', payload, 120_000);
  }

  async search(
    organizationId: string,
    query: string,
  ): Promise<{ hits: Array<{ content: string; source_id: string; similarity: number }> }> {
    return this.post('/v1/search', { organization_id: organizationId, query, top_k: 8 }, 15_000);
  }

  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'X-Internal-Token': this.token } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      this.logger.error(`ai-service ${path} inalcanzable: ${(err as Error).message}`);
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.INTERNAL,
        'El servicio de IA no está disponible en este momento.',
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`ai-service ${path} → ${res.status} ${text.slice(0, 200)}`);
      throw new AppError(
        res.status === 503 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY,
        ERROR_CODES.INTERNAL,
        'El servicio de IA devolvió un error.',
      );
    }
    return (await res.json()) as T;
  }
}
