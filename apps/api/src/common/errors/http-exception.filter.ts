import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ERROR_CODES } from '@wolfiax/shared';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

/**
 * Serializa TODA excepción al envelope estable de la API:
 *   { error: { code, message, details?, request_id } }
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ?? req.headers['x-request-id']?.toString();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL;
    let message = 'Error interno. Contacta a soporte con el request_id.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = ERROR_CODES.RATE_LIMITED;
      message = 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        code = (b.code as string) ?? this.defaultCode(status);
        message = Array.isArray(b.message)
          ? 'La solicitud contiene datos inválidos.'
          : ((b.message as string) ?? exception.message);
        // ValidationPipe entrega los errores como string[] en `message`
        if (Array.isArray(b.message)) {
          code = ERROR_CODES.VALIDATION_ERROR;
          details = (b.message as string[]).map((issue) => ({ issue }));
        }
      } else {
        code = this.defaultCode(status);
        message = exception.message;
      }
    } else {
      // Error no controlado: log completo, respuesta opaca (sin filtrar internals)
      this.logger.error(
        `Unhandled exception en ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      error: { code, message, details, request_id: requestId },
    });
  }

  private defaultCode(status: number): string {
    switch (status) {
      case 401:
        return ERROR_CODES.UNAUTHORIZED;
      case 403:
        return ERROR_CODES.FORBIDDEN;
      case 404:
        return ERROR_CODES.NOT_FOUND;
      case 429:
        return ERROR_CODES.RATE_LIMITED;
      default:
        return status >= 500 ? ERROR_CODES.INTERNAL : ERROR_CODES.VALIDATION_ERROR;
    }
  }
}
