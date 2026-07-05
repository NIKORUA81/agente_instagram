import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../common/prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  resource?: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  detail?: Prisma.InputJsonValue;
}

/**
 * Auditoría inmutable (la tabla no admite UPDATE/DELETE por RLS).
 * Se escribe dentro de la MISMA transacción del caso de uso para que
 * la acción y su registro sean atómicos.
 */
@Injectable()
export class AuditService {
  async log(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        detail: entry.detail,
      },
    });
  }
}
