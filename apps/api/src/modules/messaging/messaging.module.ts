import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingService } from './messaging.service';
import { OutboundProcessor } from './outbound.processor';

@Module({
  imports: [ChannelsModule, RealtimeModule],
  providers: [MessagingService, OutboundProcessor],
  exports: [MessagingService],
})
export class MessagingModule {}
