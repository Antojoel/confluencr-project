import { z } from 'zod';

import { amount, description, referenceId, uuid } from '../../http/validation.js';

export const createTransferBody = z
  .strictObject({
    from_account_id: uuid('from_account_id'),
    to_account_id: uuid('to_account_id'),
    amount,
    description,
    reference_id: referenceId,
  })
  .refine((body) => body.from_account_id !== body.to_account_id, {
    path: ['to_account_id'],
    message: 'to_account_id must be different from from_account_id',
  });

export type CreateTransferInput = z.output<typeof createTransferBody>;
