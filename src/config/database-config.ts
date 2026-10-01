import { config as dotenvConfig } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { resolve } from 'path';

/**
 * Load environment variables from the appropriate .env file
 * Priority: .env.{NODE_ENV}.local > .env.{NODE_ENV} > .env.dev > .env.local > .env
 */
const nodeEnv = process.env['NODE_ENV'] || 'development';
const envFiles = [
  resolve(process.cwd(), `.env.${nodeEnv}.local`),
  resolve(process.cwd(), `.env.${nodeEnv}`),
  resolve(process.cwd(), '.env.dev'),
  resolve(process.cwd(), '.env.local'),
  resolve(process.cwd(), '.env'),
];

for (const file of envFiles) {
  try {
    dotenvConfig({ path: file });
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Shared TypeORM DataSource configuration used by both:
 * - NestJS application (via TypeOrmModule)
 * - TypeORM CLI (migrations, schema sync, etc.)
 */
export const databaseConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env['DATABASE_HOST'] || '127.0.0.1',
  port: parseInt(process.env['DATABASE_PORT'] || '5432', 10),
  username: process.env['DATABASE_USERNAME'] || 'postgres',
  password: process.env['DATABASE_PASSWORD'] || 'postgres',
  database: process.env['DATABASE_NAME'] || 'boardsync',
  synchronize: false, // Always false - schema changes only via migrations
  logging: process.env['DATABASE_LOGGING'] === 'true',
  entities: [resolve(__dirname, '../../**/*.entity{.ts,.js}')],
  migrations: [resolve(__dirname, '../../database/migrations/*{.ts,.js}')],
  migrationsTableName: 'migrations',
  migrationsTransactionMode: 'each',
  migrationsRun: false, // We'll run migrations manually via scripts
  extra: {
    // Connection pool settings
    max: parseInt(process.env['DATABASE_POOL_MAX'] || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
};

/**
 * TypeORM DataSource instance for CLI usage
 * This is the single source of truth for both the app and CLI
 */
export const AppDataSource = new DataSource(databaseConfig);

/**
 * Helper function to get the DataSource instance
 * Used by NestJS app and CLI commands
 */
export function getDataSource(): Promise<import('typeorm').DataSource> {
  if (!AppDataSource.isInitialized) {
    return AppDataSource.initialize();
  }
  return Promise.resolve(AppDataSource);
}
