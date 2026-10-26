import { describe, expect, it } from 'vitest';

import { MISSING_ID, api, createAccount } from './helpers.js';

describe('POST /accounts', () => {
  it('creates an account with a zero balance and server-generated fields', async () => {
    const res = await api.post('/accounts').send({ name: '  Alice  ' }).expect(201);

    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Alice',
      balance: '0.00',
      created_at: expect.any(String),
    });
  });

  it('gives every account a unique id', async () => {
    expect(await createAccount('A')).not.toBe(await createAccount('B'));
  });

  it.each([
    [{}, 'name is required'],
    [{ name: '   ' }, 'name must not be empty'],
    [{ name: 42 }, 'name must be a string'],
    [{ name: 'x'.repeat(101) }, 'name must be at most 100 characters'],
  ])('rejects invalid body %j', async (body, message) => {
    const res = await api.post('/accounts').send(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].message).toBe(message);
  });

  it('does not let the client set the initial balance', async () => {
    const res = await api.post('/accounts').send({ name: 'Mallory', balance: 1000 }).expect(400);
    expect(res.body.error.details[0].field).toBe('balance');
  });

  it('returns INVALID_JSON for a malformed body', async () => {
    const res = await api
      .post('/accounts')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 400 when the body is missing', async () => {
    const res = await api.post('/accounts').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /accounts/:accountId/balance', () => {
  it('returns the account id and balance', async () => {
    const id = await createAccount();
    const res = await api.get(`/accounts/${id}/balance`).expect(200);
    expect(res.body).toEqual({ account_id: id, balance: '0.00' });
  });

  it('accepts an uppercase account id', async () => {
    const id = await createAccount();
    await api.get(`/accounts/${id.toUpperCase()}/balance`).expect(200);
  });

  it('returns 404 for an unknown account', async () => {
    const res = await api.get(`/accounts/${MISSING_ID}/balance`).expect(404);
    expect(res.body).toEqual({
      error: {
        code: 'ACCOUNT_NOT_FOUND',
        message: `Account ${MISSING_ID} not found`,
        details: { account_id: MISSING_ID },
      },
    });
  });

  it('returns 400 for a malformed account id', async () => {
    const res = await api.get('/accounts/not-a-uuid/balance').expect(400);
    expect(res.body.error.details[0]).toEqual({
      field: 'accountId',
      message: 'accountId must be a valid UUID',
    });
  });
});

describe('unknown routes', () => {
  it('returns a consistent 404', async () => {
    const res = await api.get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
