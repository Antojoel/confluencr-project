# Transaction Ledger API

A backend API for a simple transaction ledger: create accounts, post credits and debits, read
balances and paginated history, and transfer money between accounts. Every money movement is
atomic, the balance always equals the ledger, and transactions cannot be changed after creation.

**Stack:** Node.js 24 · TypeScript · Express 5 · PostgreSQL 17 · Zod · Vitest · ESLint · Prettier · Docker

- [Docker guide: run, test and debug everything](docs/DOCKER.md)
- [API documentation](docs/API.md)
- [Assumptions and design decisions](ASSUMPTIONS.md)

## Quick start (Docker, recommended)

Requires Docker with Compose v2.

```bash
docker compose up --build        # API on http://localhost:3000, Postgres on localhost:5432
```

The database schema is applied automatically on startup. Try it:

```bash
curl -X POST localhost:3000/accounts -H 'Content-Type: application/json' -d '{"name":"Alice"}'
# → {"id":"<uuid>","name":"Alice","balance":"0.00","created_at":"..."}

curl -X POST localhost:3000/accounts/<uuid>/transactions -H 'Content-Type: application/json' \
  -d '{"type":"credit","amount":100,"reference_id":"r-1","description":"Deposit"}'

curl localhost:3000/accounts/<uuid>/balance
curl 'localhost:3000/accounts/<uuid>/transactions?type=credit&page=1&limit=10'
```

Stop with `docker compose down`, or `docker compose down -v` to also delete the data.

## Lint, type-check and test (Docker)

```bash
docker compose --profile tools run --rm --build check   # tsc, ESLint, Prettier + 62 integration tests
docker compose --profile tools run --rm --build e2e     # 37 end-to-end tests against the running API
```

- **Integration tests** (`tests/*.test.ts`) run the app in-process against a real Postgres (the
  separate `ledger_test` database, so development data is never touched). They also check
  database-level guarantees and concurrency.
- **End-to-end tests** (`tests/e2e/ledger.e2e.ts`) call the built `api` container over HTTP,
  organised by the sections of the assessment.

See [docs/DOCKER.md](docs/DOCKER.md) for the full walk-through, expected output and troubleshooting.

## Running without Docker for the API

Requires Node.js ≥ 22 and a PostgreSQL ≥ 13 database.

```bash
npm install
docker compose up -d db          # or point DATABASE_URL at your own Postgres
export DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger   # see .env.example
npm run dev                      # watch mode on http://localhost:3000
```

| Script              | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Start with auto-reload (tsx)                      |
| `npm run build`     | Compile to `dist/`                                |
| `npm start`         | Run the compiled server                           |
| `npm test`          | Integration tests (uses `ledger_test` by default) |
| `npm run lint`      | ESLint (strict, type-aware)                       |
| `npm run typecheck` | `tsc --noEmit`                                    |
| `npm run format`    | Prettier write                                    |
| `npm run check`     | Everything above, as run in CI                    |

### Environment variables

| Variable       | Default | Description                |
| -------------- | ------- | -------------------------- |
| `DATABASE_URL` | (none)  | Postgres connection string |
| `PORT`         | `3000`  | HTTP port                  |

## Project structure

```
migrations/001_init.sql          Schema, constraints and the immutability trigger
src/
  server.ts                      Entry point: migrate, listen, graceful shutdown
  app.ts                         Express app: middleware, routes, 404, error handler
  config.ts                      Validated environment config
  db/pool.ts                     Connection pool and withTransaction()
  db/migrate.ts                  Minimal migration runner (advisory-locked)
  http/errors.ts                 AppError and error codes
  http/error-handler.ts          Maps every error to one JSON error shape
  http/validation.ts             parse() and shared field validators (uuid, amount, ...)
  modules/
    accounts/                    POST /accounts, GET /accounts/:id/balance
    transactions/
      ledger.ts                  Core: lock accounts, post an entry, move the balance
      transactions.*.ts          POST and GET /accounts/:id/transactions
    transfers/                   POST /transfers (two ledger entries, one DB transaction)
tests/                           Integration tests (supertest + real Postgres)
tests/e2e/                       End-to-end tests over HTTP against the running API
docs/API.md                      Endpoint reference
docs/DOCKER.md                   How to run, test and debug everything with Docker
ASSUMPTIONS.md                   Assumptions, integrity guarantees, trade-offs
```

Each module has `*.routes.ts` (HTTP and validation), `*.schemas.ts` (Zod) and `*.service.ts`
(business logic and SQL). `transactions/ledger.ts` is the only code that changes balances;
transactions and transfers both go through it.

## How correctness is guaranteed

- **Atomic:** the ledger row and the balance update are written in one Postgres transaction.
  Transfers write both legs in one transaction, so a partial transfer is impossible.
- **Safe under concurrency:** account rows are locked (`SELECT … FOR UPDATE`, in ID order for
  transfers to avoid deadlock). Tests send 25 parallel debits against a balance of 100 and check
  that exactly 10 succeed.
- **No overdraft, no duplicates:** checked in code under the lock, and also enforced by the
  database (`CHECK (balance >= 0)`, `UNIQUE (account_id, reference_id)`).
- **Immutable:** there are no update or delete endpoints, and a database trigger rejects
  `UPDATE`/`DELETE` on `transactions`.
- **Exact money:** `numeric` in Postgres and decimal strings in JSON, never floats.

See [ASSUMPTIONS.md](ASSUMPTIONS.md) for the full mapping and trade-offs.
