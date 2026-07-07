import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditService } from '../iam/audit.service';
import { MessagingModule } from '../messaging/messaging.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { FlowEngineService } from './flow-engine.service';
import { FlowProcessor } from './flow.processor';
import { FlowSimulatorService } from './flow-simulator.service';
import { FlowTriggerService } from './flow-trigger.service';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';

@Module({
  imports: [MessagingModule, RealtimeModule, AiModule],
  controllers: [FlowsController],
  providers: [
    FlowsService,
    FlowEngineService,
    FlowSimulatorService,
    FlowTriggerService,
    FlowProcessor,
    AuditService,
  ],
  exports: [FlowEngineService, FlowTriggerService],
})
export class FlowsModule {}
