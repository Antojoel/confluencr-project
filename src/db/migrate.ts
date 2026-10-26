import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { pool } from './pool.js';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');
// Arbitrary constant; serialises migrations when several instances boot at once.
const MIGRATION_LOCK_ID = 727_001;

/** Applies pending `migrations/*.sql` files in name order, each in its own transaction. */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files.filter((f) => !applied.has(f))) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.info(`migration applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    client.release();
  }
}
