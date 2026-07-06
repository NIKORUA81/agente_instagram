import { Module } from '@nestjs/common';
import { AuditService } from '../iam/audit.service';
import { MessagingModule } from '../messaging/messaging.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AutomationsController } from './automations.controller';
import { AutomationsEngine } from './automations.engine';
import { AutomationsService } from './automations.service';

@Module({
  imports: [MessagingModule, RealtimeModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationsEngine, AuditService],
  exports: [AutomationsEngine],
})
export class AutomationsModule {}
