import './setup-env';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/config/database-config';

/**
 * Brings the test database to a known state: drops everything and applies all migrations, so the
 * integration tests also prove that the migrations build the schema the entities expect.
 */
export default async function globalSetup(): Promise<void> {
  const dataSource = new DataSource({ ...dataSourceOptions, logging: false });
  await dataSource.initialize();
  try {
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}
