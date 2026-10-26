import request from 'supertest';
import { afterAll, beforeEach, expect } from 'vitest';

import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

// One shared server; supertest would otherwise start a new one for every request.
const server = createApp().listen(0);
export const api = request(server);

beforeEach(async () => {
  await pool.query('TRUNCATE transactions, accounts RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  server.close();
  await pool.end();
});

export async function createAccount(name = 'Alice'): Promise<string> {
  const res = await api.post('/accounts').send({ name }).expect(201);
  return (res.body as { id: string }).id;
}

export function postTransaction(
  accountId: string,
  type: 'credit' | 'debit',
  amount: number | string,
  referenceId: string,
) {
  return api
    .post(`/accounts/${accountId}/transactions`)
    .send({ type, amount, reference_id: referenceId, description: `${type} ${amount}` });
}

export async function balanceOf(accountId: string): Promise<string> {
  const res = await api.get(`/accounts/${accountId}/balance`).expect(200);
  return (res.body as { balance: string }).balance;
}

/** The stored balance must always equal credits minus debits in the ledger. */
export async function expectLedgerConsistent(accountId: string) {
  const { rows } = await pool.query<{ balance: string; ledger: string }>(
    `SELECT a.balance,
            COALESCE(SUM(CASE t.type WHEN 'credit' THEN t.amount ELSE -t.amount END), 0)::numeric(20,2) AS ledger
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.id = $1 GROUP BY a.id`,
    [accountId],
  );
  expect(rows[0]?.balance).toBe(rows[0]?.ledger);
}

export const MISSING_ID = '00000000-0000-4000-8000-000000000000';
