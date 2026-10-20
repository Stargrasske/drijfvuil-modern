import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { migrationOptions } from './persistence/configuration.js';

// Manual, destructive-capable tool. Never imported by application startup.
async function main(): Promise<void> {
  const options = migrationOptions(process.env.DRIJFVUIL_MODE, process.env.DRIJFVUIL_DATABASE_URL);
  const action = process.argv[2];
  if (action !== 'up' && action !== 'down') throw new Error('Gebruik migration:run of migration:revert.');
  const source = new DataSource(options);
  try {
    await source.initialize();
    if (action === 'up') await source.runMigrations({ transaction: 'all' });
    else await source.undoLastMigration({ transaction: 'all' });
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

main().catch(() => {
  console.error('Migratie mislukt. Controleer modus, configuratie en schema buiten deze CLI; geen automatische herhaling.');
  process.exitCode = 1;
});
