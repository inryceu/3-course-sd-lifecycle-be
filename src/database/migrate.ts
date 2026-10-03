import { Logger } from '@nestjs/common';
import { AppDataSource } from '../config/database-config';

/**
 * Production-safe migration runner (works from the compiled build, no ts-node needed).
 * Applies pending migrations and exits non-zero on failure so a container never starts serving
 * with a half-migrated schema.
 */
async function run(): Promise<void> {
  const logger = new Logger('Migrations');
  await AppDataSource.initialize();
  try {
    const applied = await AppDataSource.runMigrations({ transaction: 'each' });
    logger.log(
      applied.length === 0
        ? 'Database is up to date'
        : `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

run().catch((error: unknown) => {
  new Logger('Migrations').error(
    'Migration failed',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
