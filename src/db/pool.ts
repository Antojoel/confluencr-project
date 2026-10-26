import pg from 'pg';

import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export type Db = pg.PoolClient;

/** Runs `fn` inside one DB transaction: everything commits together or nothing does. */
export async function withTransaction<T>(fn: (client: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
