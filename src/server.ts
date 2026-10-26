import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { pool } from './db/pool.js';

await runMigrations();

const server = createApp().listen(config.PORT, () => {
  console.info(`Ledger API listening on port ${config.PORT}`);
});

function shutdown(signal: string) {
  console.info(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
