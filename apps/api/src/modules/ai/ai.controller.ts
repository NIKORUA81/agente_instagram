import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AI_TONES, type AiProfileDto, type AiTone, type TestReplyResult } from '@wolfiax/shared';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@wolfiax/shared';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiClientService } from './ai-client.service';
import { AiProfileService } from './ai-profile.service';

class UpdateAiProfileDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) system_prompt?: string;
  @IsOptional() @IsIn(AI_TONES as readonly string[]) tone?: AiTone;
  @IsOptional() @IsString() @MaxLength(40) language_policy?: string;
  @IsOptional() @IsString() @MaxLength(600) disclosure_message?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) handover_keywords?: string[];
  @IsOptional() @IsObject() guardrails?: Record<string, unknown>;
  @IsOptional() @IsObject() business_hours?: Record<string, unknown> | null;
  @IsOptional() @IsInt() @Min(0) monthly_token_budget?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1) confidence_threshold?: number;
}

class TestReplyDto {
  @IsString() channel_id!: string;
  @IsString() @MaxLength(1000) message!: string;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller()
export class AiController {
  constructor(
    private readonly profiles: AiProfileService,
    private readonly ai: AiClientService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('channels/:channelId/ai-profile')
  @ApiOperation({ summary: 'Configuración de la IA de un canal' })
  getProfile(
    @CurrentUser() user: AuthUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<AiProfileDto> {
    return this.profiles.get(user, channelId);
  }

  @Patch('channels/:channelId/ai-profile')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Actualiza la configuración de la IA' })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdateAiProfileDto,
  ): Promise<AiProfileDto> {
    return this.profiles.update(user, channelId, dto);
  }

  @Post('ai/test-reply')
  @Roles('owner', 'admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sandbox: prueba la respuesta de la IA sin enviarla' })
  async testReply(
    @CurrentUser() user: AuthUser,
    @Body() dto: TestReplyDto,
  ): Promise<TestReplyResult> {
    const profile = await this.prisma.withTenant(user.organizationId, async (tx) => {
      const channel = await tx.channel.findFirst({
        where: { id: dto.channel_id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!channel) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Canal no encontrado.');
      }
      return this.profiles.getOrCreate(tx, user.organizationId, dto.channel_id);
    });

    const res = await this.ai.reply({
      organization_id: user.organizationId,
      profile: {
        system_prompt: profile.systemPrompt,
        tone: profile.tone,
        language_policy: profile.languagePolicy,
        disclosure_message: profile.disclosureMessage,
        confidence_threshold: profile.confidenceThreshold,
        business_hours: profile.businessHours,
        guardrails: profile.guardrails,
        handover_keywords: profile.handoverKeywords,
      },
      message: dto.message,
      history: [],
      include_disclosure: false,
    });

    return {
      reply: res.reply,
      handover: res.handover,
      intent: res.intent,
      language: res.language,
      sentiment: res.sentiment,
      confidence: res.confidence,
      used_sources: res.used_sources,
      reason: res.reason,
    };
  }
}
