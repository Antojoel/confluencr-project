# Running Everything with Docker

The whole project runs in Docker: the database, the API, the lint, type and format checks,
the integration tests and the end-to-end tests. You only need Docker installed. Node.js,
npm and PostgreSQL do **not** need to be installed on your machine.

## Contents

1. [Prerequisites](#1-prerequisites)
2. [What runs where](#2-what-runs-where)
3. [Start the API](#3-start-the-api)
4. [Check it is working](#4-check-it-is-working)
5. [Try the API by hand](#5-try-the-api-by-hand)
6. [Run the automated checks](#6-run-the-automated-checks)
7. [Logs, database shell and debugging](#7-logs-database-shell-and-debugging)
8. [Stop and reset](#8-stop-and-reset)
9. [Troubleshooting](#9-troubleshooting)
10. [Command cheat sheet](#10-command-cheat-sheet)

---

## 1. Prerequisites

| Tool           | Version | Check with               |
| -------------- | ------- | ------------------------ |
| Docker         | 24+     | `docker --version`       |
| Docker Compose | v2+     | `docker compose version` |

On macOS and Windows, install **Docker Desktop** and make sure it is running (the whale icon
in the menu bar or system tray). Free ports **3000** (API) and **5432** (Postgres) on your
machine, or see [Troubleshooting](#9-troubleshooting) to change them.

All commands below are run from the project root (the folder containing `compose.yaml`).

## 2. What runs where

`compose.yaml` defines four services:

| Service | Image / build target     | Starts with                 | Purpose                                                                  |
| ------- | ------------------------ | --------------------------- | ------------------------------------------------------------------------ |
| `db`    | `postgres:17-alpine`     | `docker compose up`         | PostgreSQL. Holds the `ledger` (app) and `ledger_test` (test) databases. |
| `api`   | `Dockerfile` → `runtime` | `docker compose up`         | The API on port 3000. Applies the schema on startup.                     |
| `check` | `Dockerfile` → `dev`     | `--profile tools run check` | Type check, lint, format check, integration tests.                       |
| `e2e`   | `Dockerfile` → `dev`     | `--profile tools run e2e`   | End-to-end tests over HTTP against the running `api`.                    |

`check` and `e2e` are in the `tools` profile, so a plain `docker compose up` does not start them.

```
┌──────────────┐      HTTP :3000      ┌──────────────┐      SQL :5432      ┌──────────────────────┐
│ you / curl / │ ───────────────────▶ │     api      │ ──────────────────▶ │          db          │
│ e2e tests    │                      │ (runtime img)│                     │ ledger   ledger_test │
└──────────────┘                      └──────────────┘                     └──────────▲───────────┘
                                                                                      │
                                      ┌──────────────┐  integration tests             │
                                      │    check     │ ───────────────────────────────┘
                                      │  (dev image) │  (uses ledger_test only)
                                      └──────────────┘
```

**The Dockerfile has three stages:**

- `dev`: all dependencies plus the source code. Used for linting and tests.
- `build`: compiles TypeScript to `dist/`.
- `runtime`: production dependencies plus compiled code only. Runs as the non-root `node`
  user and includes a `HEALTHCHECK` on `/health`.

**Data** is stored in the named volume `pgdata`, so it survives restarts until you run
`docker compose down -v`.

## 3. Start the API

```bash
docker compose up --build
```

The first build takes a minute or two. When it is ready you will see:

```
api-1  | migration applied: 001_init.sql
api-1  | Ledger API listening on port 3000
```

(`migration applied` only appears the first time, on an empty database.)

To run it in the background instead:

```bash
docker compose up --build -d
docker compose ps          # wait until api shows "(healthy)"
```

The API is now at **http://localhost:3000**. Compose waits for Postgres to be healthy before
it starts the API, so there is no race on startup.

## 4. Check it is working

```bash
curl localhost:3000/health
# {"status":"ok"}          ← API is up and connected to the database

docker compose ps
# NAME             SERVICE   STATUS
# confuencr-api-1  api       Up 30 seconds (healthy)
# confuencr-db-1   db        Up 35 seconds (healthy)
```

## 5. Try the API by hand

The full reference is in [API.md](API.md). This walk-through covers every requirement in
the assessment. Copy and paste it into a terminal (bash or zsh).

```bash
URL=localhost:3000
JSON='Content-Type: application/json'

# --- 1. Create accounts -----------------------------------------------------------
curl -s -X POST $URL/accounts -H "$JSON" -d '{"name":"Alice"}'
# {"id":"<uuid>","name":"Alice","balance":"0.00","created_at":"..."}

# Save the ids (paste them from the responses above, or use this helper)
A=$(curl -s -X POST $URL/accounts -H "$JSON" -d '{"name":"Alice"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
B=$(curl -s -X POST $URL/accounts -H "$JSON" -d '{"name":"Bob"}'   | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "A=$A  B=$B"

# The client cannot set a balance → 400
curl -s -X POST $URL/accounts -H "$JSON" -d '{"name":"Mallory","balance":1000}'

# --- 2. Transactions ---------------------------------------------------------------
curl -s -X POST $URL/accounts/$A/transactions -H "$JSON" \
  -d '{"type":"credit","amount":100,"reference_id":"r1","description":"Salary"}'
curl -s -X POST $URL/accounts/$A/transactions -H "$JSON" \
  -d '{"type":"debit","amount":30,"reference_id":"r2","description":"Groceries"}'

# Duplicate reference_id on the same account → 409, balance unchanged
curl -s -X POST $URL/accounts/$A/transactions -H "$JSON" \
  -d '{"type":"credit","amount":100,"reference_id":"r1"}'

# Same reference_id on a different account → allowed (201)
curl -s -X POST $URL/accounts/$B/transactions -H "$JSON" \
  -d '{"type":"credit","amount":50,"reference_id":"r1"}'

# Debit more than the balance → 422, balance unchanged
curl -s -X POST $URL/accounts/$A/transactions -H "$JSON" \
  -d '{"type":"debit","amount":1000,"reference_id":"r3"}'

# --- 3. Balance ----------------------------------------------------------------------
curl -s $URL/accounts/$A/balance          # {"account_id":"...","balance":"70.00"}

# --- 4. History: filter, pagination, latest first ------------------------------------
curl -s "$URL/accounts/$A/transactions"
curl -s "$URL/accounts/$A/transactions?type=debit"
curl -s "$URL/accounts/$A/transactions?page=1&limit=1"

# --- 9. Transfer (A=70, B=50 → transfer 30 → A=40, B=80) ------------------------------
curl -s -X POST $URL/transfers -H "$JSON" \
  -d "{\"from_account_id\":\"$A\",\"to_account_id\":\"$B\",\"amount\":30,\"reference_id\":\"t1\"}"
curl -s $URL/accounts/$A/balance
curl -s $URL/accounts/$B/balance

# --- Error handling --------------------------------------------------------------------
curl -s $URL/accounts/00000000-0000-4000-8000-000000000000/balance   # 404 ACCOUNT_NOT_FOUND
curl -s $URL/accounts/not-a-uuid/balance                             # 400 VALIDATION_ERROR
curl -s "$URL/accounts/$A/transactions?page=0"                       # 400 invalid pagination
curl -s -X POST $URL/accounts -H "$JSON" -d '{"name":'               # 400 INVALID_JSON
```

Add `-i` to any `curl` to see the HTTP status line, or pipe the output through `jq` if you
have it installed, for pretty JSON.

You can make the same requests from Postman or Insomnia, using `http://localhost:3000` as
the base URL.

## 6. Run the automated checks

There are two test suites. Both run entirely in Docker.

### 6.1 Static checks and integration tests (`check`)

```bash
docker compose --profile tools run --rm --build check
```

This runs `npm run check` inside the `dev` image, in this order:

| Step           | Tool                        | What it verifies                                                  |
| -------------- | --------------------------- | ----------------------------------------------------------------- |
| `typecheck`    | `tsc --noEmit`              | The whole codebase compiles under strict TypeScript.              |
| `lint`         | ESLint (strict, type-aware) | Code quality and type-safety rules.                               |
| `format:check` | Prettier                    | Consistent formatting.                                            |
| `test`         | Vitest + Supertest          | **62 integration tests** against a real Postgres (`ledger_test`). |

The integration tests run the app in-process and also inspect the database directly. They
cover the immutability trigger, the `balance >= 0` constraint, ledger-versus-balance
consistency, and concurrency (parallel debits, parallel duplicate references, and opposite
transfers that could deadlock). Before each test they empty the **`ledger_test`** database
only. Your data in `ledger` is never touched.

Expected ending:

```
 ✓ tests/transactions.test.ts (39 tests)
 ✓ tests/transfers.test.ts (9 tests)
 ✓ tests/accounts.test.ts (14 tests)
      Tests  62 passed (62)
```

### 6.2 End-to-end tests against the running container (`e2e`)

```bash
docker compose --profile tools run --rm --build e2e
```

This starts `db` and `api` if needed, waits until the API is healthy, then runs
`tests/e2e/ledger.e2e.ts` over real HTTP against `http://api:3000`. It tests the **built
production image** exactly as a client would see it. It is organised by the sections of the
assessment:

| Section                    | What is verified                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Health                     | `/health` reports the API and database are up                                                                                    |
| 1. Create Account          | Server-generated id, zero balance, timestamp; unique ids; name required; client balance rejected                                 |
| 2. Add Transaction         | All fields stored; credit 100+50=150; debit 100−30=70; overdraft rejected; duplicate handling; same reference on another account |
| 3. Get Balance             | `account_id` and `balance`; 404 for an unknown account                                                                           |
| 4. Transaction History     | Latest first; type filter; page/limit with full metadata; invalid params; 404                                                    |
| 5. Data Integrity          | No edit/delete routes; spec example 0+100+50−30−20=100; failed requests change nothing; 25 parallel debits; exact decimals       |
| 7–8. Validation and errors | Each invalid field returns 400 naming it; 404s; malformed JSON; unknown route                                                    |
| 9. Transfer                | A=100,B=50 → 70/80; insufficient funds; missing account; credit-leg failure rolls back the debit; same account                   |

Expected ending:

```
 ✓ tests/e2e/ledger.e2e.ts (37 tests)
      Tests  37 passed (37)
```

Every e2e test creates its own accounts, so the suite is safe to run against a database
that already has data and can be run as many times as you like. It does leave those test
accounts in the `ledger` database; run `docker compose down -v` for a clean slate.

### 6.3 Run everything from scratch (what a reviewer would do)

```bash
docker compose down -v                                   # clean slate
docker compose --profile tools run --rm --build check    # static checks + 62 integration tests
docker compose --profile tools run --rm --build e2e      # starts the API + 37 e2e tests
curl localhost:3000/health                               # API is still running for manual testing
```

## 7. Logs, database shell and debugging

```bash
docker compose logs -f api                 # follow API logs (Ctrl+C to stop following)
docker compose logs db                     # Postgres logs

# Open a SQL shell on the app database
docker compose exec db psql -U ledger -d ledger
```

Useful queries inside `psql`:

```sql
\dt                                          -- list tables
SELECT id, name, balance FROM accounts ORDER BY created_at DESC LIMIT 10;
SELECT type, amount, balance_after, reference_id FROM transactions
 WHERE account_id = '<uuid>' ORDER BY created_at DESC, seq DESC;

-- The stored balance must equal credits minus debits for every account (expect 0 rows):
SELECT a.id, a.balance,
       COALESCE(SUM(CASE t.type WHEN 'credit' THEN t.amount ELSE -t.amount END), 0) AS ledger
  FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
 GROUP BY a.id HAVING a.balance <> COALESCE(SUM(CASE t.type WHEN 'credit' THEN t.amount ELSE -t.amount END), 0);

-- Immutability is enforced by the database itself (this fails):
UPDATE transactions SET amount = 1;
\q
```

Run any npm script inside the dev image without installing Node locally:

```bash
docker compose --profile tools run --rm check npm run lint
docker compose --profile tools run --rm check npm test
```

## 8. Stop and reset

```bash
docker compose down              # stop and remove containers; data is kept
docker compose down -v           # also delete the database volume (fresh start next time)
docker compose up --build        # rebuild after code changes
```

## 9. Troubleshooting

| Symptom                                                             | Cause and fix                                                                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bind for 0.0.0.0:5432 failed: port is already allocated`           | A local Postgres is already running. Stop it, or change `'5432:5432'` to `'5433:5432'` under `db` in `compose.yaml`. Containers still talk to each other on 5432 internally. |
| `Bind for 0.0.0.0:3000 failed`                                      | Something else is using port 3000. Change `'3000:3000'` to e.g. `'3001:3000'` and use `localhost:3001`.                                                                      |
| `Cannot connect to the Docker daemon`                               | Docker Desktop is not running. Start it and wait until it reports "running".                                                                                                 |
| Integration tests fail with `database "ledger_test" does not exist` | The `db` volume was created before the init script existed. Run `docker compose down -v` and try again (the script only runs on an empty volume).                            |
| `api` never becomes healthy                                         | Run `docker compose logs api`. Usually the database is unreachable or a migration failed.                                                                                    |
| Code changes don't show up                                          | Rebuild: `docker compose up --build` (or add `--build` to the `run` commands).                                                                                               |
| `curl: (7) Failed to connect`                                       | The API is not running yet. Check `docker compose ps` and wait for `(healthy)`.                                                                                              |

## 10. Command cheat sheet

| Task                           | Command                                                 |
| ------------------------------ | ------------------------------------------------------- |
| Start (foreground)             | `docker compose up --build`                             |
| Start (background)             | `docker compose up --build -d`                          |
| Status                         | `docker compose ps`                                     |
| Health                         | `curl localhost:3000/health`                            |
| Lint, types, format + 62 tests | `docker compose --profile tools run --rm --build check` |
| 37 end-to-end tests            | `docker compose --profile tools run --rm --build e2e`   |
| API logs                       | `docker compose logs -f api`                            |
| SQL shell                      | `docker compose exec db psql -U ledger -d ledger`       |
| Stop                           | `docker compose down`                                   |
| Stop and wipe data             | `docker compose down -v`                                |
