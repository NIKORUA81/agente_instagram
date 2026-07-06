import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AiClientService } from './ai-client.service';
import { AiProfileService } from './ai-profile.service';
import { AiReplyService } from './ai-reply.service';
import { AiController } from './ai.controller';

@Module({
  imports: [MessagingModule, RealtimeModule],
  controllers: [AiController],
  providers: [AiClientService, AiProfileService, AiReplyService],
  exports: [AiClientService, AiProfileService, AiReplyService],
})
export class AiModule {}
