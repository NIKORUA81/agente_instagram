import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [IamModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
