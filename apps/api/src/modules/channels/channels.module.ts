import { Module } from '@nestjs/common';
import { TokenCipherService } from '../../common/crypto/token-cipher.service';
import { IamModule } from '../iam/iam.module';
import { AuditService } from '../iam/audit.service';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { MetaGraphService } from './meta-graph.service';
import { MetaOAuthService } from './meta-oauth.service';
import { TokenRenewalService } from './token-renewal.service';

@Module({
  imports: [IamModule],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    MetaGraphService,
    MetaOAuthService,
    TokenRenewalService,
    TokenCipherService,
    AuditService,
  ],
  exports: [ChannelsService, MetaGraphService, TokenCipherService],
})
export class ChannelsModule {}
