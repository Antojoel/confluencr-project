import { pool, withTransaction } from '../../db/pool.js';
import { assertAccountExists } from '../accounts/accounts.service.js';
import {
  TRANSACTION_COLUMNS,
  lockAccounts,
  postEntry,
  type Transaction,
  type TransactionType,
} from './ledger.js';

export interface CreateTransactionInput {
  type: TransactionType;
  amount: string;
  description: string | null;
  reference_id: string;
}

export function createTransaction(
  accountId: string,
  input: CreateTransactionInput,
): Promise<Transaction> {
  return withTransaction(async (db) => {
    await lockAccounts(db, [accountId]);
    return postEntry(db, {
      accountId,
      type: input.type,
      amount: input.amount,
      description: input.description,
      referenceId: input.reference_id,
    });
  });
}

export interface ListTransactionsInput {
  type?: TransactionType | undefined;
  page: number;
  limit: number;
}

export async function listTransactions(
  accountId: string,
  { type, page, limit }: ListTransactionsInput,
) {
  await assertAccountExists(accountId);

  const filter = 'account_id = $1 AND ($2::transaction_type IS NULL OR type = $2)';
  const [count, items] = await Promise.all([
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM transactions WHERE ${filter}`,
      [accountId, type ?? null],
    ),
    pool.query<Transaction>(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE ${filter}
        ORDER BY created_at DESC, seq DESC
        LIMIT $3 OFFSET $4`,
      [accountId, type ?? null, limit, (page - 1) * limit],
    ),
  ]);

  const total = count.rows[0]?.total ?? 0;
  return {
    data: items.rows,
    pagination: { page, limit, total_records: total, total_pages: Math.ceil(total / limit) },
  };
}
