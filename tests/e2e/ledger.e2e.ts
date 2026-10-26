/**
 * End-to-end tests against a running API (the Docker `api` container by default).
 * They only use HTTP, like a real client, and walk through the assessment spec section by
 * section. Every test creates its own accounts, so they can run against a database that
 * already has data in it.
 */
import { describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

interface ApiResponse {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- asserted per test
}

async function call(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newAccount(name = 'E2E User'): Promise<string> {
  const res = await call('POST', '/accounts', { name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const post = (accountId: string, type: string, amount: unknown, referenceId: string) =>
  call('POST', `/accounts/${accountId}/transactions`, {
    type,
    amount,
    reference_id: referenceId,
    description: `${type} ${String(amount)}`,
  });

async function balance(accountId: string): Promise<string> {
  const res = await call('GET', `/accounts/${accountId}/balance`);
  expect(res.status).toBe(200);
  return res.body.balance as string;
}

function expectError(res: ApiResponse, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    error: expect.objectContaining({ code, message: expect.any(String) }),
  });
}

describe('service health', () => {
  it('GET /health reports the API and database are up', async () => {
    const res = await call('GET', '/health');
    expect(res).toEqual({ status: 200, body: { status: 'ok' } });
  });
});

describe('1. Create Account', () => {
  it('creates an account with id, name, zero balance and a server timestamp', async () => {
    const before = Date.now();
    const res = await call('POST', '/accounts', { name: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Alice',
      balance: '0.00',
      created_at: expect.any(String),
    });
    expect(Date.parse(res.body.created_at)).toBeGreaterThanOrEqual(before - 60_000);
  });

  it('generates unique ids', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => newAccount()));
    expect(new Set(ids).size).toBe(5);
  });

  it('requires a name', async () => {
    expectError(await call('POST', '/accounts', {}), 400, 'VALIDATION_ERROR');
    expectError(await call('POST', '/accounts', { name: '   ' }), 400, 'VALIDATION_ERROR');
  });

  it('does not let the client set the initial balance', async () => {
    const res = await call('POST', '/accounts', { name: 'Mallory', balance: 1_000_000 });
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual({
      field: 'balance',
      message: 'Unrecognized key: "balance"',
    });
  });
});

describe('2. Add Transaction', () => {
  it('stores every required field on the transaction', async () => {
    const id = await newAccount();
    const res = await post(id, 'credit', 100, 'ref-fields');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      account_id: id,
      type: 'credit',
      amount: '100.00',
      balance_after: '100.00',
      description: 'credit 100',
      reference_id: 'ref-fields',
      transfer_id: null,
      created_at: expect.any(String),
    });
  });

  it('credit: 100 + 50 = 150', async () => {
    const id = await newAccount();
    await post(id, 'credit', 100, 'seed');
    expect((await post(id, 'credit', 50, 'c')).status).toBe(201);
    expect(await balance(id)).toBe('150.00');
  });

  it('debit: 100 - 30 = 70', async () => {
    const id = await newAccount();
    await post(id, 'credit', 100, 'seed');
    expect((await post(id, 'debit', 30, 'd')).status).toBe(201);
    expect(await balance(id)).toBe('70.00');
  });

  it('debit of 150 on a balance of 100 is rejected and the balance stays 100', async () => {
    const id = await newAccount();
    await post(id, 'credit', 100, 'seed');

    const res = await post(id, 'debit', 150, 'too-much');
    expectError(res, 422, 'INSUFFICIENT_BALANCE');
    expect(await balance(id)).toBe('100.00');
  });

  describe('duplicate transactions', () => {
    it('a repeated reference_id on the same account creates nothing and changes nothing', async () => {
      const id = await newAccount();
      const first = await post(id, 'credit', 100, 'once');

      const again = await post(id, 'credit', 100, 'once');
      expectError(again, 409, 'DUPLICATE_TRANSACTION');
      expect(again.body.error.details.transaction.id).toBe(first.body.id);
      expect(await balance(id)).toBe('100.00');

      const history = await call('GET', `/accounts/${id}/transactions`);
      expect(history.body.pagination.total_records).toBe(1);
    });

    it('the same reference_id may be used on different accounts', async () => {
      const a = await newAccount();
      const b = await newAccount();
      expect((await post(a, 'credit', 10, 'shared')).status).toBe(201);
      expect((await post(b, 'credit', 10, 'shared')).status).toBe(201);
    });
  });
});

describe('3. Get Account Balance', () => {
  it('returns account_id and balance', async () => {
    const id = await newAccount();
    const res = await call('GET', `/accounts/${id}/balance`);
    expect(res).toEqual({ status: 200, body: { account_id: id, balance: '0.00' } });
  });

  it('returns 404 for an account that does not exist', async () => {
    expectError(await call('GET', `/accounts/${MISSING_ID}/balance`), 404, 'ACCOUNT_NOT_FOUND');
  });
});

describe('4. Get Transaction History', () => {
  async function seededAccount() {
    const id = await newAccount();
    // 3 credits and 2 debits, posted in order h-0 .. h-4
    const plan = ['credit', 'credit', 'debit', 'credit', 'debit'];
    for (const [i, type] of plan.entries()) {
      expect((await post(id, type, 10, `h-${i}`)).status).toBe(201);
    }
    return id;
  }
  const refs = (res: ApiResponse) =>
    (res.body.data as { reference_id: string }[]).map((t) => t.reference_id);

  it('returns both types, latest first, when no filter is given', async () => {
    const id = await seededAccount();
    const res = await call('GET', `/accounts/${id}/transactions`);
    expect(res.status).toBe(200);
    expect(refs(res)).toEqual(['h-4', 'h-3', 'h-2', 'h-1', 'h-0']);
  });

  it('filters by type', async () => {
    const id = await seededAccount();
    const credits = await call('GET', `/accounts/${id}/transactions?type=credit`);
    const debits = await call('GET', `/accounts/${id}/transactions?type=debit`);
    expect(refs(credits)).toEqual(['h-3', 'h-1', 'h-0']);
    expect(refs(debits)).toEqual(['h-4', 'h-2']);
  });

  it('paginates with page and limit and reports page, size, total records and total pages', async () => {
    const id = await seededAccount();
    const pages = await Promise.all(
      [1, 2, 3].map((page) => call('GET', `/accounts/${id}/transactions?page=${page}&limit=2`)),
    );

    expect(pages.map(refs)).toEqual([['h-4', 'h-3'], ['h-2', 'h-1'], ['h-0']]);
    expect(pages[0]?.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total_records: 5,
      total_pages: 3,
    });
  });

  it('rejects invalid pagination parameters', async () => {
    const id = await newAccount();
    for (const query of ['page=0', 'page=abc', 'limit=0', 'limit=1000', 'type=refund']) {
      expectError(
        await call('GET', `/accounts/${id}/transactions?${query}`),
        400,
        'VALIDATION_ERROR',
      );
    }
  });

  it('returns 404 for an account that does not exist', async () => {
    expectError(
      await call('GET', `/accounts/${MISSING_ID}/transactions`),
      404,
      'ACCOUNT_NOT_FOUND',
    );
  });
});

describe('5. Data Integrity', () => {
  it('transactions cannot be edited or deleted through the API', async () => {
    const id = await newAccount();
    const tx = await post(id, 'credit', 10, 'immutable');
    const path = `/accounts/${id}/transactions/${tx.body.id}`;

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expectError(await call(method, path, { amount: 999 }), 404, 'NOT_FOUND');
    }
    const history = await call('GET', `/accounts/${id}/transactions`);
    expect(history.body.data[0]).toEqual(tx.body);
  });

  it('balance consistency example: 0 +100 +50 -30 -20 = 100', async () => {
    const id = await newAccount();
    await post(id, 'credit', 100, 'a');
    await post(id, 'credit', 50, 'b');
    await post(id, 'debit', 30, 'c');
    await post(id, 'debit', 20, 'd');
    expect(await balance(id)).toBe('100.00');
  });

  it('failed transactions do not affect the balance', async () => {
    const id = await newAccount();
    await post(id, 'credit', 100, 'seed');
    await post(id, 'debit', 500, 'overdraft'); // 422
    await post(id, 'credit', 100, 'seed'); // 409 duplicate
    await post(id, 'credit', -1, 'negative'); // 400
    expect(await balance(id)).toBe('100.00');
  });

  it('atomicity under concurrency: 25 parallel debits of 10 on a balance of 100', async () => {
    const id = await newAccount();
    await post(id, 'credit', 100, 'seed');

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => post(id, 'debit', 10, `par-${i}`)),
    );
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(15);
    expect(await balance(id)).toBe('0.00');
  });

  it('decimal amounts are exact (0.10 + 0.20 = 0.30)', async () => {
    const id = await newAccount();
    await post(id, 'credit', '0.10', 'x');
    await post(id, 'credit', 0.2, 'y');
    expect(await balance(id)).toBe('0.30');
  });
});

describe('7. Validations and 8. Error Handling', () => {
  it.each([
    ['invalid transaction type', { type: 'refund', amount: 10, reference_id: 'r' }, 'type'],
    ['zero amount', { type: 'credit', amount: 0, reference_id: 'r' }, 'amount'],
    ['negative amount', { type: 'credit', amount: -10, reference_id: 'r' }, 'amount'],
    ['non-numeric amount', { type: 'credit', amount: 'ten', reference_id: 'r' }, 'amount'],
    ['missing reference_id', { type: 'credit', amount: 10 }, 'reference_id'],
  ])('%s returns 400 naming the field', async (_case, body, field) => {
    const id = await newAccount();
    const res = await call('POST', `/accounts/${id}/transactions`, body);
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('a transaction on a non-existent account returns 404', async () => {
    expectError(await post(MISSING_ID, 'credit', 10, 'r'), 404, 'ACCOUNT_NOT_FOUND');
  });

  it('a malformed account id returns 400', async () => {
    expectError(await call('GET', '/accounts/not-a-uuid/balance'), 400, 'VALIDATION_ERROR');
  });

  it('a malformed JSON body returns 400 INVALID_JSON', async () => {
    expectError(await call('POST', '/accounts', '{"name": '), 400, 'INVALID_JSON');
  });

  it('an unknown route returns a JSON 404', async () => {
    expectError(await call('GET', '/does-not-exist'), 404, 'NOT_FOUND');
  });
});

describe('9. Bonus: Money Transfer', () => {
  async function pair() {
    const a = await newAccount('A');
    const b = await newAccount('B');
    await post(a, 'credit', 100, 'seed');
    await post(b, 'credit', 50, 'seed');
    return { a, b };
  }
  const transfer = (from: string, to: string, amount: unknown, referenceId = 't') =>
    call('POST', '/transfers', {
      from_account_id: from,
      to_account_id: to,
      amount,
      reference_id: referenceId,
    });

  it('A=100, B=50, transfer 30 from A to B gives A=70, B=80', async () => {
    const { a, b } = await pair();
    const res = await transfer(a, b, 30);

    expect(res.status).toBe(201);
    expect(res.body.debit_transaction).toMatchObject({ account_id: a, type: 'debit' });
    expect(res.body.credit_transaction).toMatchObject({ account_id: b, type: 'credit' });
    expect(await balance(a)).toBe('70.00');
    expect(await balance(b)).toBe('80.00');
  });

  it('insufficient balance rejects the whole transfer', async () => {
    const { a, b } = await pair();
    expectError(await transfer(a, b, 1000), 422, 'INSUFFICIENT_BALANCE');
    expect(await balance(a)).toBe('100.00');
    expect(await balance(b)).toBe('50.00');
  });

  it('both accounts must exist', async () => {
    const { a } = await pair();
    expectError(await transfer(a, MISSING_ID, 10), 404, 'ACCOUNT_NOT_FOUND');
    expectError(await transfer(MISSING_ID, a, 10), 404, 'ACCOUNT_NOT_FOUND');
    expect(await balance(a)).toBe('100.00');
  });

  it('a failure in the credit leg rolls back the debit (no partial transfer)', async () => {
    const { a, b } = await pair();
    await post(b, 'credit', 1, 'clash'); // B already uses this reference

    expectError(await transfer(a, b, 30, 'clash'), 409, 'DUPLICATE_TRANSACTION');
    expect(await balance(a)).toBe('100.00');
    expect(await balance(b)).toBe('51.00');
  });

  it('cannot transfer to the same account', async () => {
    const { a } = await pair();
    expectError(await transfer(a, a, 10), 400, 'VALIDATION_ERROR');
  });
});
