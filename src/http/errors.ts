export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'ACCOUNT_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'DUPLICATE_TRANSACTION'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

/** An error that maps directly onto an HTTP response. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const accountNotFound = (accountId: string) =>
  new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} not found`, {
    account_id: accountId,
  });
