import { Router } from 'express';

import { parse } from '../../http/validation.js';
import { accountParams, createAccountBody } from './accounts.schemas.js';
import { createAccount, getBalance } from './accounts.service.js';

export const accountsRouter = Router();

accountsRouter.post('/', async (req, res) => {
  const { name } = parse(createAccountBody, req.body);
  res.status(201).json(await createAccount(name));
});

accountsRouter.get('/:accountId/balance', async (req, res) => {
  const { accountId } = parse(accountParams, req.params);
  res.json(await getBalance(accountId));
});
