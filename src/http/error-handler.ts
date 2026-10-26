import type { ErrorRequestHandler } from 'express';

import { AppError } from './errors.js';

interface BodyParserError {
  type: string;
  status: number;
}

const isBodyParserError = (err: unknown): err is BodyParserError =>
  typeof err === 'object' && err !== null && 'type' in err && 'status' in err;

const isPgError = (err: unknown): err is { code: string; constraint?: string } =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string';

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (isBodyParserError(err) && err.status < 500) {
    return err.type === 'entity.parse.failed'
      ? new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON')
      : new AppError(err.status, 'VALIDATION_ERROR', 'Request body could not be read');
  }

  // Safety net: the service checks for duplicates under a row lock, so this should not fire.
  if (
    isPgError(err) &&
    err.code === '23505' &&
    err.constraint === 'transactions_account_reference_unique'
  ) {
    return new AppError(
      409,
      'DUPLICATE_TRANSACTION',
      'A transaction with this reference_id already exists for this account',
    );
  }

  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  if (appError.status >= 500) console.error(`${req.method} ${req.originalUrl} failed`, err);

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  });
};
