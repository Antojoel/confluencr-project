import { z } from 'zod';

import { AppError } from './errors.js';

/** Parses `input` or throws a 400 listing every invalid field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    field:
      issue.code === 'unrecognized_keys'
        ? issue.keys.join(', ')
        : issue.path.length > 0
          ? issue.path.join('.')
          : 'body',
    message: issue.message,
  }));
  throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
}

const requiredMessage = (field: string, expected: string) => (issue: { input: unknown }) =>
  issue.input === undefined ? `${field} is required` : `${field} must be ${expected}`;

export const uuid = (field: string) =>
  z
    .uuid({ error: requiredMessage(field, 'a valid UUID') })
    // Postgres returns lowercase UUIDs; normalise so lookups and comparisons match.
    .transform((id) => id.toLowerCase());

export const requiredText = (field: string, maxLength: number) =>
  z
    .string({ error: requiredMessage(field, 'a string') })
    .trim()
    .min(1, `${field} must not be empty`)
    .max(maxLength, `${field} must be at most ${maxLength} characters`);

export const description = z
  .string({ error: 'description must be a string' })
  .trim()
  .max(255, 'description must be at most 255 characters')
  .nullish()
  .transform((value) => value || null);

function amountError(value: string): string | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return 'amount must be a number, e.g. 100 or "100.50"';
  if (Number(value) <= 0) return 'amount must be greater than 0';
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return 'amount must have at most 2 decimal places';
  if (!/^\d{1,12}(\.|$)/.test(value)) return 'amount must be less than 1,000,000,000,000';
  return null;
}

/**
 * Money is kept as a decimal string end to end (JSON -> Postgres numeric -> JSON) so it is
 * never rounded through a binary float. Accepts 100, 100.5 and "100.50".
 */
export const amount = z
  .union([z.number(), z.string()], { error: requiredMessage('amount', 'a number') })
  .transform((value, ctx) => {
    const text = String(value).trim();
    const error = amountError(text);
    if (error === null) return text;
    ctx.addIssue({ code: 'custom', message: error });
    return z.NEVER;
  });

export const referenceId = requiredText('reference_id', 100);
