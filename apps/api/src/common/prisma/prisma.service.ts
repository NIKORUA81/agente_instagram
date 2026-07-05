import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

/**
 * Acceso a datos con aislamiento multi-tenant vía Row-Level Security.
 *
 * Reglas de uso (revisadas en code review, no negociables):
 *  - Los casos de uso tenant-scoped usan SIEMPRE `withTenant(orgId, fn)`.
 *  - Solo el módulo IAM (login/registro/refresh/aceptar invitación) puede usar
 *    `withSystem(fn)`, porque opera legítimamente antes de conocer el tenant.
 *  - Consultas directas sobre `this` (sin contexto) devuelven 0 filas en las
 *    tablas protegidas: es la red de seguridad de RLS actuando.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Ejecuta `fn` en una transacción con el tenant fijado para RLS. */
  withTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
      return fn(tx);
    });
  }

  /** Ejecuta `fn` en contexto de sistema (solo módulo IAM). */
  withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_system', 'on', true)`;
      return fn(tx);
    });
  }
}
