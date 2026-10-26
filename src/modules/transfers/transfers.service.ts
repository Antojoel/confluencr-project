import { randomUUID } from 'node:crypto';

import { withTransaction } from '../../db/pool.js';
import { lockAccounts, postEntry } from '../transactions/ledger.js';
import type { CreateTransferInput } from './transfers.schemas.js';

/**
 * Debits the source and credits the destination in one DB transaction. Any failure (missing
 * account, insufficient balance, duplicate reference on either side) rolls back both legs.
 */
export function createTransfer(input: CreateTransferInput) {
  const transferId = randomUUID();
  const { from_account_id: from, to_account_id: to, amount, reference_id: referenceId } = input;

  return withTransaction(async (db) => {
    await lockAccounts(db, [from, to]);
    const debit = await postEntry(db, {
      accountId: from,
      type: 'debit',
      amount,
      description: input.description ?? `Transfer to ${to}`,
      referenceId,
      transferId,
    });
    const credit = await postEntry(db, {
      accountId: to,
      type: 'credit',
      amount,
      description: input.description ?? `Transfer from ${from}`,
      referenceId,
      transferId,
    });

    return {
      transfer_id: transferId,
      from_account_id: from,
      to_account_id: to,
      amount: debit.amount,
      reference_id: referenceId,
      created_at: debit.created_at,
      debit_transaction: debit,
      credit_transaction: credit,
    };
  });
}
