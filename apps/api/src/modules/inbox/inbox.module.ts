import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AutomationsModule } from '../automations/automations.module';
import { ChannelsModule } from '../channels/channels.module';
import { FlowsModule } from '../flows/flows.module';
import { IamModule } from '../iam/iam.module';
import { AuditService } from '../iam/audit.service';
import { MessagingModule } from '../messaging/messaging.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ContactsController } from './contacts.controller';
import { ConversationsController } from './conversations.controller';
import { InboundProcessor } from './inbound.processor';
import { TagsController } from './tags.controller';

@Module({
  imports: [
    IamModule,
    ChannelsModule,
    RealtimeModule,
    MessagingModule,
    AutomationsModule,
    AiModule,
    FlowsModule,
  ],
  controllers: [ConversationsController, TagsController, ContactsController],
  providers: [InboundProcessor, AuditService],
})
export class InboxModule {}
