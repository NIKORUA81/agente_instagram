import { HttpStatus, Injectable } from '@nestjs/common';
import type { AiProfile, Prisma } from '@prisma/client';
import { ERROR_CODES, type AiProfileDto, type AiTone } from '@wolfiax/shared';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';

export function toAiProfileDto(p: AiProfile): AiProfileDto {
  return {
    id: p.id,
    channel_id: p.channelId,
    enabled: p.enabled,
    system_prompt: p.systemPrompt,
    tone: p.tone as AiTone,
    language_policy: p.languagePolicy,
    disclosure_message: p.disclosureMessage,
    handover_keywords: p.handoverKeywords,
    guardrails: (p.guardrails as Record<string, unknown>) ?? {},
    business_hours: (p.businessHours as Record<string, unknown> | null) ?? null,
    monthly_token_budget: p.monthlyTokenBudget !== null ? Number(p.monthlyTokenBudget) : null,
    tokens_used_month: Number(p.tokensUsedMonth),
    confidence_threshold: p.confidenceThreshold,
    updated_at: p.updatedAt.toISOString(),
  };
}

export interface UpdateAiProfileInput {
  enabled?: boolean;
  system_prompt?: string;
  tone?: string;
  language_policy?: string;
  disclosure_message?: string;
  handover_keywords?: string[];
  guardrails?: Record<string, unknown>;
  business_hours?: Record<string, unknown> | null;
  monthly_token_budget?: number | null;
  confidence_threshold?: number;
}

@Injectable()
export class AiProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve el perfil del canal, creándolo con valores por defecto si no existe. */
  async getOrCreate(tx: Tx, organizationId: string, channelId: string): Promise<AiProfile> {
    const existing = await tx.aiProfile.findUnique({ where: { channelId } });
    if (existing) return existing;
    return tx.aiProfile.create({ data: { organizationId, channelId } });
  }

  async get(actor: AuthUser, channelId: string): Promise<AiProfileDto> {
    const profile = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.assertChannel(tx, actor.organizationId, channelId);
      return this.getOrCreate(tx, actor.organizationId, channelId);
    });
    return toAiProfileDto(profile);
  }

  async update(
    actor: AuthUser,
    channelId: string,
    input: UpdateAiProfileInput,
  ): Promise<AiProfileDto> {
    const profile = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.assertChannel(tx, actor.organizationId, channelId);
      await this.getOrCreate(tx, actor.organizationId, channelId);
      return tx.aiProfile.update({
        where: { channelId },
        data: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.system_prompt !== undefined ? { systemPrompt: input.system_prompt } : {}),
          ...(input.tone !== undefined ? { tone: input.tone } : {}),
          ...(input.language_policy !== undefined ? { languagePolicy: input.language_policy } : {}),
          ...(input.disclosure_message !== undefined
            ? { disclosureMessage: input.disclosure_message }
            : {}),
          ...(input.handover_keywords !== undefined
            ? { handoverKeywords: input.handover_keywords }
            : {}),
          ...(input.guardrails !== undefined
            ? { guardrails: input.guardrails as Prisma.InputJsonValue }
            : {}),
          ...(input.business_hours !== undefined
            ? { businessHours: (input.business_hours ?? undefined) as Prisma.InputJsonValue }
            : {}),
          ...(input.monthly_token_budget !== undefined
            ? { monthlyTokenBudget: input.monthly_token_budget }
            : {}),
          ...(input.confidence_threshold !== undefined
            ? { confidenceThreshold: input.confidence_threshold }
            : {}),
        },
      });
    });
    return toAiProfileDto(profile);
  }

  private async assertChannel(tx: Tx, orgId: string, channelId: string): Promise<void> {
    const channel = await tx.channel.findFirst({
      where: { id: channelId, organizationId: orgId },
      select: { id: true },
    });
    if (!channel) {
      throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Canal no encontrado.');
    }
  }
}
