import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PasswordService } from '../../common/crypto/password.service';
import { decodeJwtKeys, type Env } from '../../config/configuration';
import { AuditService } from './audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InvitationsService } from './invitations.service';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const { privateKey, publicKey } = decodeJwtKeys({
          JWT_PRIVATE_KEY_BASE64: config.get('JWT_PRIVATE_KEY_BASE64', { infer: true }),
          JWT_PUBLIC_KEY_BASE64: config.get('JWT_PUBLIC_KEY_BASE64', { infer: true }),
        } as Env);
        return {
          privateKey,
          publicKey,
          signOptions: { algorithm: 'RS256' },
          verifyOptions: { algorithms: ['RS256'] },
        };
      },
    }),
  ],
  controllers: [AuthController, OrgsController],
  providers: [
    AuthService,
    TokensService,
    OrgsService,
    InvitationsService,
    AuditService,
    PasswordService,
  ],
  exports: [TokensService],
})
export class IamModule {}
