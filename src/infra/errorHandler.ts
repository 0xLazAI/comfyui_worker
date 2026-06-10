import type { NextFunction, Request, Response } from 'express';
import { currentRequestId, logger } from './logger.js';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  logger.error('request failed %s', err?.stack || err?.message || err);
  const statusCode = err?.statusCode || 500;
  res.status(statusCode).json({
    code: statusCode,
    message: err?.message || 'Internal Server Error',
    requestId: currentRequestId(),
  });
}
