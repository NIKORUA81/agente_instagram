import { HttpException } from '@nestjs/common';

export interface AppErrorDetail {
  field?: string;
  issue: string;
}

/**
 * Error de negocio con código estable (contrato con el frontend, ver
 * ERROR_CODES en @wolfiax/shared). El filtro global lo serializa al
 * formato { error: { code, message, details, request_id } }.
 */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details?: AppErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }
}
