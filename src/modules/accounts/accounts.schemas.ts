import { z } from 'zod';

import { requiredText, uuid } from '../../http/validation.js';

// Strict: a client-supplied `balance` (or any unknown field) is rejected, never ignored.
export const createAccountBody = z.strictObject({ name: requiredText('name', 100) });

export const accountParams = z.object({ accountId: uuid('accountId') });
