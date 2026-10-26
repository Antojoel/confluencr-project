import { z } from 'zod';

import { amount, description, referenceId } from '../../http/validation.js';

const transactionType = z.enum(['credit', 'debit'], {
  error: (issue) =>
    issue.input === undefined ? 'type is required' : 'type must be either "credit" or "debit"',
});

export const createTransactionBody = z.strictObject({
  type: transactionType,
  amount,
  description,
  reference_id: referenceId,
});

const positiveInt = (field: string, fallback: number, max?: number) =>
  z.coerce
    .number({ error: `${field} must be a positive integer` })
    .int(`${field} must be a positive integer`)
    .min(1, `${field} must be a positive integer`)
    .max(max ?? Number.MAX_SAFE_INTEGER, `${field} must be at most ${max}`)
    .default(fallback);

export const MAX_PAGE_SIZE = 100;

export const listTransactionsQuery = z.object({
  type: transactionType.optional(),
  page: positiveInt('page', 1),
  limit: positiveInt('limit', 20, MAX_PAGE_SIZE),
});
