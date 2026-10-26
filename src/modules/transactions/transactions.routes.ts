import { Router } from 'express';

import { parse } from '../../http/validation.js';
import { accountParams } from '../accounts/accounts.schemas.js';
import { createTransactionBody, listTransactionsQuery } from './transactions.schemas.js';
import { createTransaction, listTransactions } from './transactions.service.js';

// Mounted under /accounts/:accountId/transactions. There are deliberately no update or
// delete routes: transactions are immutable.
export const transactionsRouter = Router({ mergeParams: true });

transactionsRouter.post('/', async (req, res) => {
  const { accountId } = parse(accountParams, req.params);
  const body = parse(createTransactionBody, req.body);
  res.status(201).json(await createTransaction(accountId, body));
});

transactionsRouter.get('/', async (req, res) => {
  const { accountId } = parse(accountParams, req.params);
  const query = parse(listTransactionsQuery, req.query);
  res.json(await listTransactions(accountId, query));
});
