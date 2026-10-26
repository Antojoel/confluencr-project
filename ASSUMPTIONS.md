# Assumptions and Design Decisions

## Assumptions

1. **Currency and precision.** Accounts are in one currency with two decimal places. Amounts with
   more than 2 decimals are rejected rather than rounded, and the maximum single amount is
   999,999,999,999.99.
2. **Money is returned as strings** (`"150.00"`). JSON numbers are binary floats in most clients,
   so a string is the only lossless representation. Requests accept either form.
3. **Duplicate `reference_id` returns `409 Conflict`** with the original transaction in
   `details.transaction`. The spec asks for "an appropriate response indicating that the
   transaction already exists". A 409 makes the conflict explicit, and including the original
   lets a client that retried after a timeout get the result without a second lookup. The
   payload of the retry is not compared with the original.
4. **Duplicates are checked before the balance.** Re-sending an already-processed debit returns
   `409`, even if the account no longer has enough money, because the request was already
   applied once.
5. **Insufficient balance returns `422 Unprocessable Entity`**: the request is well formed but
   breaks a business rule. Invalid input is `400`.
6. **Malformed IDs return `400`, unknown IDs return `404`.** `not-a-uuid` is invalid input; a valid
   UUID with no matching account is "not found".
7. **`description` is optional** (max 255 chars). The spec lists it as a field but not as a
   required validation; it is stored as `null` when omitted.
8. **Unknown request fields are rejected** (`400`), not silently ignored. This is how "the client
   should not be allowed to set the initial balance" is enforced, and it catches client typos.
9. **The account must be in the URL** (`POST /accounts/{id}/transactions`) instead of an
   `account_id` body field, to match the nested history route.
10. **Transfers use one `reference_id` for both legs**, so it must be unused on both accounts. Each
    leg is a normal ledger transaction, linked by a shared `transfer_id`.
11. **Pagination:** `page` defaults to 1, `limit` to 20 with a maximum of 100. A page past the end
    returns an empty list (not an error). Transactions with the same `created_at` (the two legs
    of a transfer) are ordered by insertion sequence.
12. **Out of scope:** authentication and authorisation, multiple currencies, account
    updates or closure, and rate limiting. Nothing in the spec asked for them.

## How the integrity requirements are met

| Requirement         | Implementation                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomicity           | Each transaction or transfer runs in a single Postgres transaction (`withTransaction`). Any error rolls back every write.                                                                                                     |
| Concurrency         | The account row is locked with `SELECT … FOR UPDATE` before reading or writing, so concurrent requests on one account run one after another. Transfers lock both accounts in ID order, which prevents deadlocks.              |
| No overdraft        | The debit is a conditional `UPDATE … WHERE balance >= amount`, and the `CHECK (balance >= 0)` constraint backs it up.                                                                                                         |
| Duplicates          | Checked under the account lock, with `UNIQUE (account_id, reference_id)` as a backstop.                                                                                                                                       |
| Immutability        | No update or delete routes, and a database trigger rejects `UPDATE`/`DELETE` on `transactions`.                                                                                                                               |
| Balance consistency | The balance changes only in the same database transaction that inserts the ledger row. Each row also stores `balance_after`, so the history can be audited. Tests check `balance = Σcredits − Σdebits` after concurrent load. |
| Initial balance 0   | The column default is `0`; the API never accepts a balance from the client.                                                                                                                                                   |
| Exact money         | Postgres `numeric(…, 2)` holds every value; arithmetic is done in SQL, never in JS floats.                                                                                                                                    |

## Trade-offs

- **Stored balance plus ledger, rather than computing the balance from the ledger on every
  read.** Reads are O(1), and the lock plus constraints keep the two in sync. The ledger stays
  the audit source of truth.
- **Raw SQL with `pg` instead of an ORM.** The important logic (row locks, conditional updates,
  constraints) is explicit and easy to review in a few short queries.
- **Migrations run at startup** under a Postgres advisory lock, so several instances cannot
  apply them at the same time. A larger system would run them as a separate deploy step.
- **`COUNT(*)` for `total_records`.** Fine at this scale. A very large ledger would use
  keyset (cursor) pagination instead.
