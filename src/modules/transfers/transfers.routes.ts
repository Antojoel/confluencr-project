import { Router } from 'express';

import { parse } from '../../http/validation.js';
import { createTransferBody } from './transfers.schemas.js';
import { createTransfer } from './transfers.service.js';

export const transfersRouter = Router();

transfersRouter.post('/', async (req, res) => {
  const body = parse(createTransferBody, req.body);
  res.status(201).json(await createTransfer(body));
});
