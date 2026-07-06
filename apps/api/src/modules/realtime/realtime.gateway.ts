import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokensService } from '../iam/tokens.service';

/**
 * Tiempo real hacia el dashboard. Autenticación por access token en el
 * handshake; cada cliente entra a la sala de su organización — el aislamiento
 * multi-tenant también aplica al WebSocket.
 *
 * NOTA escalado: con >1 réplica del api se añade @socket.io/redis-adapter
 * (previsto en doc 02); en F1 corre una sola instancia.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: process.env.WEB_ORIGIN, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly tokens: TokensService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('sin token');
      const payload = await this.tokens.verifyAccessToken(token);
      await client.join(`org:${payload.org}`);
    } catch {
      this.logger.warn('Conexión WS rechazada (token inválido)');
      client.disconnect(true);
    }
  }

  emitToOrg(organizationId: string, event: string, payload: unknown): void {
    this.server.to(`org:${organizationId}`).emit(event, payload);
  }
}
