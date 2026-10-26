import express from 'express';

import { pool } from './db/pool.js';
import { errorHandler } from './http/error-handler.js';
import { AppError } from './http/errors.js';
import { accountsRouter } from './modules/accounts/accounts.routes.js';
import { transactionsRouter } from './modules/transactions/transactions.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/accounts', accountsRouter);
  app.use('/accounts/:accountId/transactions', transactionsRouter);
  app.use('/transfers', transfersRouter);

  app.use((req, _res, next) => {
    next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
  });
  app.use(errorHandler);

  return app;
}
