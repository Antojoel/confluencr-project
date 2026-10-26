-- Accounts hold the running balance; transactions are the immutable ledger behind it.

CREATE TABLE accounts (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text          NOT NULL,
  balance    numeric(20,2) NOT NULL DEFAULT 0,
  created_at timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT accounts_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT accounts_balance_non_negative CHECK (balance >= 0)
);

CREATE TYPE transaction_type AS ENUM ('credit', 'debit');

CREATE TABLE transactions (
  id            uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tie-breaker for latest-first ordering: rows written in one DB transaction share now().
  seq           bigint           GENERATED ALWAYS AS IDENTITY UNIQUE,
  account_id    uuid             NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  type          transaction_type NOT NULL,
  amount        numeric(14,2)    NOT NULL,
  balance_after numeric(20,2)    NOT NULL,
  description   text,
  reference_id  text             NOT NULL,
  transfer_id   uuid,
  created_at    timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT transactions_balance_after_non_negative CHECK (balance_after >= 0),
  CONSTRAINT transactions_description_length CHECK (length(description) <= 255),
  CONSTRAINT transactions_reference_not_blank CHECK (length(btrim(reference_id)) BETWEEN 1 AND 100),
  CONSTRAINT transactions_account_reference_unique UNIQUE (account_id, reference_id)
);

CREATE INDEX transactions_account_history_idx
  ON transactions (account_id, created_at DESC, seq DESC);

-- Ledger entries are append-only, even for clients that bypass the API.
CREATE FUNCTION reject_transaction_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'transactions are immutable (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION reject_transaction_mutation();
