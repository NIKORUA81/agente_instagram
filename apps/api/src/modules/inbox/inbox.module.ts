import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { IamModule } from '../iam/iam.module';
import { ConversationsController } from './conversations.controller';
import { InboundProcessor } from './inbound.processor';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [IamModule, ChannelsModule],
  controllers: [ConversationsController],
  providers: [InboundProcessor, RealtimeGateway],
})
export class InboxModule {}
