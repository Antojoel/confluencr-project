import type { Db } from '../../db/pool.js';
import { AppError, accountNotFound } from '../../http/errors.js';

export type TransactionType = 'credit' | 'debit';

export interface Transaction {
  id: string;
  account_id: string;
  type: TransactionType;
  amount: string;
  balance_after: string;
  description: string | null;
  reference_id: string;
  transfer_id: string | null;
  created_at: Date;
}

export interface EntryInput {
  accountId: string;
  type: TransactionType;
  amount: string;
  description: string | null;
  referenceId: string;
  transferId?: string;
}

export const TRANSACTION_COLUMNS =
  'id, account_id, type, amount, balance_after, description, reference_id, transfer_id, created_at';

/**
 * Locks the accounts' rows until the surrounding DB transaction ends, so concurrent writes to
 * the same account run one after another. Rows are locked in id order so two transfers in
 * opposite directions cannot deadlock.
 */
export async function lockAccounts(db: Db, accountIds: string[]): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [accountIds],
  );
  const found = new Set(rows.map((row) => row.id));
  const missing = accountIds.find((id) => !found.has(id));
  if (missing !== undefined) throw accountNotFound(missing);
}

/**
 * Appends one ledger entry and moves the balance by the same amount.
 * The caller must already hold the account lock (see `lockAccounts`) inside a DB transaction.
 */
export async function postEntry(db: Db, entry: EntryInput): Promise<Transaction> {
  const existing = await db.query<Transaction>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE account_id = $1 AND reference_id = $2`,
    [entry.accountId, entry.referenceId],
  );
  if (existing.rows[0]) {
    throw new AppError(
      409,
      'DUPLICATE_TRANSACTION',
      `A transaction with reference_id "${entry.referenceId}" already exists for account ${entry.accountId}`,
      { transaction: existing.rows[0] },
    );
  }

  // The balance comparison happens in SQL so money never passes through a JS float.
  const updated = await db.query<{ balance: string }>(
    `UPDATE accounts
        SET balance = balance + CASE WHEN $2::text = 'credit' THEN $3::numeric ELSE -$3::numeric END
      WHERE id = $1 AND ($2::text = 'credit' OR balance >= $3::numeric)
      RETURNING balance`,
    [entry.accountId, entry.type, entry.amount],
  );
  const balanceAfter = updated.rows[0]?.balance;
  if (balanceAfter === undefined) {
    const { rows } = await db.query<{ balance: string }>(
      'SELECT balance FROM accounts WHERE id = $1',
      [entry.accountId],
    );
    throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit', {
      account_id: entry.accountId,
      balance: rows[0]?.balance,
      requested_amount: entry.amount,
    });
  }

  const inserted = await db.query<Transaction>(
    `INSERT INTO transactions
       (account_id, type, amount, balance_after, description, reference_id, transfer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${TRANSACTION_COLUMNS}`,
    [
      entry.accountId,
      entry.type,
      entry.amount,
      balanceAfter,
      entry.description,
      entry.referenceId,
      entry.transferId ?? null,
    ],
  );
  return inserted.rows[0] as Transaction;
}
