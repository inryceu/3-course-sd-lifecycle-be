import { config as dotenvConfig } from 'dotenv';
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { resolve } from 'path';
import { envFilePaths } from './env-files';

/** Load environment variables for the TypeORM CLI (see `env-files.ts` for precedence). */
for (const file of envFilePaths()) {
  dotenvConfig({ path: file, quiet: true });
}

/**
 * The single data source definition used by the Nest application
 * (TypeOrmModule spreads these options) and by the TypeORM CLI.
 *
 * - `synchronize` is false in every environment: the schema changes only through migrations.
 * - Entities are owned by modules and live in `modules/<module>/infrastructure/**`; the glob is
 *   relative to this file so it works from `src` (ts-node) and from `dist` (compiled).
 * - Migrations live in `src/database/migrations` so they are compiled into `dist`.
 */
export const dataSourceOptions: PostgresConnectionOptions = {
  type: 'postgres',
  host: process.env['DATABASE_HOST'] || 'localhost',
  port: parseInt(process.env['DATABASE_PORT'] || '5432', 10),
  username: process.env['DATABASE_USERNAME'] || 'postgres',
  password: process.env['DATABASE_PASSWORD'] || 'postgres',
  database: process.env['DATABASE_NAME'] || 'boardsync',
  synchronize: false,
  logging: process.env['DATABASE_LOGGING'] === 'true',
  uuidExtension: 'pgcrypto',
  entities: [resolve(__dirname, '../modules/*/infrastructure/**/*.entity{.ts,.js}')],
  migrations: [resolve(__dirname, '../database/migrations/*{.ts,.js}')],
  migrationsTableName: 'migrations',
  migrationsTransactionMode: 'each',
  migrationsRun: false,
  extra: {
    max: parseInt(process.env['DATABASE_POOL_MAX'] || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
};

/** DataSource instance for the TypeORM CLI and the migration runner only. */
export const AppDataSource = new DataSource(dataSourceOptions);
