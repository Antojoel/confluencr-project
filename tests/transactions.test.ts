import { describe, expect, it } from 'vitest';

import { pool } from '../src/db/pool.js';
import {
  MISSING_ID,
  api,
  balanceOf,
  createAccount,
  expectLedgerConsistent,
  postTransaction,
} from './helpers.js';

describe('POST /accounts/:accountId/transactions', () => {
  it('credits increase and debits decrease the balance', async () => {
    const id = await createAccount();

    const credit = await postTransaction(id, 'credit', 100, 'ref-1').expect(201);
    expect(credit.body).toEqual({
      id: expect.any(String),
      account_id: id,
      type: 'credit',
      amount: '100.00',
      balance_after: '100.00',
      description: 'credit 100',
      reference_id: 'ref-1',
      transfer_id: null,
      created_at: expect.any(String),
    });

    await postTransaction(id, 'debit', 30, 'ref-2').expect(201);
    expect(await balanceOf(id)).toBe('70.00');
  });

  it('matches the balance-consistency example from the spec (0 +100 +50 -30 -20 = 100)', async () => {
    const id = await createAccount();
    await postTransaction(id, 'credit', 100, 'a').expect(201);
    await postTransaction(id, 'credit', 50, 'b').expect(201);
    await postTransaction(id, 'debit', 30, 'c').expect(201);
    await postTransaction(id, 'debit', 20, 'd').expect(201);

    expect(await balanceOf(id)).toBe('100.00');
    await expectLedgerConsistent(id);
  });

  it('handles decimal amounts exactly (no float drift)', async () => {
    const id = await createAccount();
    await postTransaction(id, 'credit', '0.10', 'a').expect(201);
    await postTransaction(id, 'credit', 0.2, 'b').expect(201);
    expect(await balanceOf(id)).toBe('0.30');
  });

  it('rejects a debit larger than the balance and leaves everything unchanged', async () => {
    const id = await createAccount();
    await postTransaction(id, 'credit', 100, 'a').expect(201);

    const res = await postTransaction(id, 'debit', 150, 'b').expect(422);
    expect(res.body.error).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: 'Insufficient balance for this debit',
      details: { account_id: id, balance: '100.00', requested_amount: '150' },
    });
    expect(await balanceOf(id)).toBe('100.00');

    const history = await api.get(`/accounts/${id}/transactions`).expect(200);
    expect(history.body.pagination.total_records).toBe(1);
  });

  it('allows debiting the exact balance down to zero', async () => {
    const id = await createAccount();
    await postTransaction(id, 'credit', 100, 'a').expect(201);
    await postTransaction(id, 'debit', 100, 'b').expect(201);
    expect(await balanceOf(id)).toBe('0.00');
  });

  it('rejects a duplicate reference_id on the same account without changing the balance', async () => {
    const id = await createAccount();
    const first = await postTransaction(id, 'credit', 100, 'dup').expect(201);

    const res = await postTransaction(id, 'credit', 100, 'dup').expect(409);
    expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(res.body.error.details.transaction.id).toBe(first.body.id);
    expect(await balanceOf(id)).toBe('100.00');
  });

  it('allows the same reference_id on different accounts', async () => {
    const a = await createAccount('A');
    const b = await createAccount('B');
    await postTransaction(a, 'credit', 10, 'shared').expect(201);
    await postTransaction(b, 'credit', 10, 'shared').expect(201);
  });

  it('returns 404 when the account does not exist', async () => {
    const res = await postTransaction(MISSING_ID, 'credit', 10, 'x').expect(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('makes description optional', async () => {
    const id = await createAccount();
    const res = await api
      .post(`/accounts/${id}/transactions`)
      .send({ type: 'credit', amount: 5, reference_id: 'r' })
      .expect(201);
    expect(res.body.description).toBeNull();
  });

  it.each([
    [{ type: 'refund' }, 'type', 'type must be either "credit" or "debit"'],
    [{ type: undefined }, 'type', 'type is required'],
    [{ amount: 0 }, 'amount', 'amount must be greater than 0'],
    [{ amount: -5 }, 'amount', 'amount must be greater than 0'],
    [{ amount: '10.001' }, 'amount', 'amount must have at most 2 decimal places'],
    [{ amount: 'ten' }, 'amount', 'amount must be a number, e.g. 100 or "100.50"'],
    [{ amount: 1e12 }, 'amount', 'amount must be less than 1,000,000,000,000'],
    [{ amount: undefined }, 'amount', 'amount is required'],
    [{ reference_id: undefined }, 'reference_id', 'reference_id is required'],
    [{ reference_id: '  ' }, 'reference_id', 'reference_id must not be empty'],
    [{ account_id: 'x' }, 'account_id', 'Unrecognized key: "account_id"'],
  ])('rejects %j', async (override, field, message) => {
    const id = await createAccount();
    const body = { type: 'credit', amount: 10, reference_id: 'r', ...override };
    const res = await api.post(`/accounts/${id}/transactions`).send(body).expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual({ field, message });
    expect(await balanceOf(id)).toBe('0.00');
  });

  it('serialises concurrent debits so the balance never goes negative', async () => {
    const id = await createAccount();
    await postTransaction(id, 'credit', 100, 'seed').expect(201);

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => postTransaction(id, 'debit', 10, `d-${i}`)),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 422)).toHaveLength(15);
    expect(await balanceOf(id)).toBe('0.00');
    await expectLedgerConsistent(id);
  });

  it('creates exactly one transaction for concurrent requests with the same reference_id', async () => {
    const id = await createAccount();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => postTransaction(id, 'credit', 10, 'same')),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await balanceOf(id)).toBe('10.00');
  });
});

describe('GET /accounts/:accountId/transactions', () => {
  async function seed() {
    const id = await createAccount();
    const types = ['credit', 'credit', 'debit', 'credit', 'debit'] as const;
    for (const [i, type] of types.entries()) {
      await postTransaction(id, type, 10, `ref-${i}`).expect(201);
    }
    return id;
  }

  it('returns transactions latest-first with pagination metadata', async () => {
    const id = await seed();
    const res = await api.get(`/accounts/${id}/transactions?page=1&limit=2`).expect(200);

    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total_records: 5,
      total_pages: 3,
    });
    expect(res.body.data.map((t: { reference_id: string }) => t.reference_id)).toEqual([
      'ref-4',
      'ref-3',
    ]);

    const last = await api.get(`/accounts/${id}/transactions?page=3&limit=2`).expect(200);
    expect(last.body.data.map((t: { reference_id: string }) => t.reference_id)).toEqual(['ref-0']);
  });

  it('defaults to page 1, limit 20 and both types', async () => {
    const id = await seed();
    const res = await api.get(`/accounts/${id}/transactions`).expect(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total_pages: 1 });
  });

  it.each([
    ['credit', 3],
    ['debit', 2],
  ])('filters by type=%s', async (type, count) => {
    const id = await seed();
    const res = await api.get(`/accounts/${id}/transactions?type=${type}`).expect(200);
    expect(res.body.pagination.total_records).toBe(count);
    expect(res.body.data.every((t: { type: string }) => t.type === type)).toBe(true);
  });

  it('returns an empty page past the end', async () => {
    const id = await seed();
    const res = await api.get(`/accounts/${id}/transactions?page=99`).expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total_records).toBe(5);
  });

  it('returns empty results for an account with no transactions', async () => {
    const id = await createAccount();
    const res = await api.get(`/accounts/${id}/transactions`).expect(200);
    expect(res.body).toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total_records: 0, total_pages: 0 },
    });
  });

  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1.5', 'page'],
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['type=refund', 'type'],
  ])('rejects invalid query %s', async (query, field) => {
    const id = await createAccount();
    const res = await api.get(`/accounts/${id}/transactions?${query}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe(field);
  });

  it('returns 404 for an unknown account', async () => {
    await api.get(`/accounts/${MISSING_ID}/transactions`).expect(404);
  });
});

describe('transaction immutability', () => {
  it('exposes no update or delete routes', async () => {
    const id = await createAccount();
    const tx = await postTransaction(id, 'credit', 10, 'r').expect(201);
    const path = `/accounts/${id}/transactions/${tx.body.id}`;

    await api.put(path).send({ amount: 999 }).expect(404);
    await api.patch(path).send({ amount: 999 }).expect(404);
    await api.delete(path).expect(404);
  });

  it('is enforced by the database even outside the API', async () => {
    const id = await createAccount();
    const tx = await postTransaction(id, 'credit', 10, 'r').expect(201);

    await expect(
      pool.query('UPDATE transactions SET amount = 999 WHERE id = $1', [tx.body.id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query('DELETE FROM transactions WHERE id = $1', [tx.body.id]),
    ).rejects.toThrow(/immutable/);
  });

  it('rejects a negative balance at the database level', async () => {
    const id = await createAccount();
    await expect(
      pool.query('UPDATE accounts SET balance = -1 WHERE id = $1', [id]),
    ).rejects.toThrow(/accounts_balance_non_negative/);
  });
});
