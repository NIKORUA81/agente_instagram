import { Module } from '@nestjs/common';
import { PasswordService } from '../../common/crypto/password.service';
import { IamModule } from '../iam/iam.module';
import { AuditService } from '../iam/audit.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SuperAdminSeeder } from './super-admin.seeder';

@Module({
  imports: [IamModule], // exporta TokensService (impersonación)
  controllers: [PlatformController],
  providers: [PlatformService, SuperAdminSeeder, PasswordService, AuditService],
})
export class PlatformModule {}
