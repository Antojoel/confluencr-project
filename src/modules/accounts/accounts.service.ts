import { pool } from '../../db/pool.js';
import { accountNotFound } from '../../http/errors.js';

export interface Account {
  id: string;
  name: string;
  balance: string;
  created_at: Date;
}

export async function createAccount(name: string): Promise<Account> {
  // id, balance (0) and created_at come from column defaults, never from the client.
  const { rows } = await pool.query<Account>(
    'INSERT INTO accounts (name) VALUES ($1) RETURNING id, name, balance, created_at',
    [name],
  );
  return rows[0] as Account;
}

export async function getBalance(
  accountId: string,
): Promise<{ account_id: string; balance: string }> {
  const { rows } = await pool.query<{ account_id: string; balance: string }>(
    'SELECT id AS account_id, balance FROM accounts WHERE id = $1',
    [accountId],
  );
  if (!rows[0]) throw accountNotFound(accountId);
  return rows[0];
}

export async function assertAccountExists(accountId: string): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  if (rowCount === 0) throw accountNotFound(accountId);
}
