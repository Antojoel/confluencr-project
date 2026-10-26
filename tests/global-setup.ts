export default async function setup() {
  const { runMigrations } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/db/pool.js');
  await runMigrations();
  await pool.end();
}
