import { describe, expect, it } from 'vitest';

import {
  MISSING_ID,
  api,
  balanceOf,
  createAccount,
  expectLedgerConsistent,
  postTransaction,
} from './helpers.js';

async function setup() {
  const a = await createAccount('A');
  const b = await createAccount('B');
  await postTransaction(a, 'credit', 100, 'seed-a').expect(201);
  await postTransaction(b, 'credit', 50, 'seed-b').expect(201);
  return { a, b };
}

const transfer = (body: Record<string, unknown>) => api.post('/transfers').send(body);

describe('POST /transfers', () => {
  it('moves money from A to B (100/50, transfer 30 -> 70/80)', async () => {
    const { a, b } = await setup();

    const res = await transfer({
      from_account_id: a,
      to_account_id: b,
      amount: 30,
      reference_id: 't-1',
    }).expect(201);

    expect(res.body).toMatchObject({
      from_account_id: a,
      to_account_id: b,
      amount: '30.00',
      reference_id: 't-1',
      debit_transaction: { account_id: a, type: 'debit', balance_after: '70.00' },
      credit_transaction: { account_id: b, type: 'credit', balance_after: '80.00' },
    });
    expect(res.body.debit_transaction.transfer_id).toBe(res.body.transfer_id);
    expect(res.body.credit_transaction.transfer_id).toBe(res.body.transfer_id);
    expect(await balanceOf(a)).toBe('70.00');
    expect(await balanceOf(b)).toBe('80.00');
  });

  it('rolls back entirely on insufficient balance', async () => {
    const { a, b } = await setup();
    const res = await transfer({
      from_account_id: a,
      to_account_id: b,
      amount: 101,
      reference_id: 't',
    }).expect(422);

    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(a)).toBe('100.00');
    expect(await balanceOf(b)).toBe('50.00');
  });

  it('rolls back the debit when the credit leg fails', async () => {
    const { a, b } = await setup();
    // The debit on A succeeds, then the credit on B hits B's existing reference_id.
    await postTransaction(b, 'credit', 1, 'taken').expect(201);

    await transfer({
      from_account_id: a,
      to_account_id: b,
      amount: 30,
      reference_id: 'taken',
    }).expect(409);

    expect(await balanceOf(a)).toBe('100.00');
    expect(await balanceOf(b)).toBe('51.00');
    const history = await api.get(`/accounts/${a}/transactions?type=debit`).expect(200);
    expect(history.body.data).toEqual([]);
  });

  it('rejects a repeated transfer reference', async () => {
    const { a, b } = await setup();
    const body = { from_account_id: a, to_account_id: b, amount: 10, reference_id: 't' };
    await transfer(body).expect(201);
    await transfer(body).expect(409);
    expect(await balanceOf(a)).toBe('90.00');
  });

  it.each(['from', 'to'] as const)(
    'returns 404 when the %s account does not exist',
    async (side) => {
      const { a } = await setup();
      const res = await transfer({
        from_account_id: side === 'from' ? MISSING_ID : a,
        to_account_id: side === 'to' ? MISSING_ID : a,
        amount: 10,
        reference_id: 't',
      }).expect(404);

      expect(res.body.error.details.account_id).toBe(MISSING_ID);
      expect(await balanceOf(a)).toBe('100.00');
    },
  );

  it('rejects a transfer to the same account', async () => {
    const { a } = await setup();
    const res = await transfer({
      from_account_id: a,
      to_account_id: a,
      amount: 10,
      reference_id: 't',
    }).expect(400);
    expect(res.body.error.details[0].field).toBe('to_account_id');
  });

  it('rejects invalid amounts and missing fields', async () => {
    const { a, b } = await setup();
    await transfer({ from_account_id: a, to_account_id: b, amount: 0, reference_id: 't' }).expect(
      400,
    );
    const res = await transfer({}).expect(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual([
      'from_account_id',
      'to_account_id',
      'amount',
      'reference_id',
    ]);
  });

  it('keeps both ledgers consistent under concurrent opposite transfers (no deadlock)', async () => {
    const { a, b } = await setup();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        transfer({
          from_account_id: i % 2 ? a : b,
          to_account_id: i % 2 ? b : a,
          amount: 5,
          reference_id: `c-${i}`,
        }),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(a)).toBe('100.00');
    expect(await balanceOf(b)).toBe('50.00');
    await expectLedgerConsistent(a);
    await expectLedgerConsistent(b);
  });
});
