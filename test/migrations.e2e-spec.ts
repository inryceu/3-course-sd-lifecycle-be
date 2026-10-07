import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/config/database-config';

/**
 * Applies every migration to a brand-new empty database, reverts all of them and applies them
 * again. A scratch database is used so the shared test database is never touched.
 */
describe('Migrations (e2e)', () => {
  const name = `bs_migrations_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: DataSource;
  let dataSource: DataSource;

  const tables = async (): Promise<string[]> =>
    (
      await dataSource.query<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY table_name`,
      )
    ).map((row) => row.table_name);

  beforeAll(async () => {
    admin = new DataSource({ ...dataSourceOptions, database: 'postgres', logging: false });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    dataSource = new DataSource({ ...dataSourceOptions, database: name, logging: false });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.destroy();
  });

  it('never synchronises the schema and uses one shared definition', () => {
    expect(dataSourceOptions.synchronize).toBe(false);
    expect(dataSource.options.synchronize).toBe(false);
  });

  it('applies cleanly to an empty database', async () => {
    expect(await dataSource.showMigrations()).toBe(true);

    const applied = await dataSource.runMigrations({ transaction: 'each' });

    expect(applied.length).toBeGreaterThanOrEqual(2);
    expect(await dataSource.showMigrations()).toBe(false);
    expect(await tables()).toEqual(
      expect.arrayContaining([
        'users',
        'boards',
        'columns',
        'cards',
        'labels',
        'comments',
        'card_labels',
        'board_memberships',
        'jira_connections',
        'jira_oauth_states',
        'jira_issue_mappings',
        'sync_logs',
        'migrations',
      ]),
    );
  });

  it('matches the entities exactly (no pending schema changes)', async () => {
    const sql = await dataSource.driver.createSchemaBuilder().log();
    expect(sql.upQueries.map((q) => q.query)).toEqual([]);
  });

  it('gives every table a uuid primary key and timestamptz audit columns', async () => {
    const rows = await dataSource.query<
      { table_name: string; column_name: string; data_type: string }[]
    >(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('id', 'createdAt', 'updatedAt')`,
    );
    const byTable = new Map<string, Map<string, string>>();
    for (const row of rows) {
      byTable.set(
        row.table_name,
        (byTable.get(row.table_name) ?? new Map()).set(row.column_name, row.data_type),
      );
    }
    for (const table of [
      'users',
      'boards',
      'columns',
      'cards',
      'labels',
      'comments',
      'board_memberships',
    ]) {
      const columns = byTable.get(table);
      expect(columns?.get('id')).toBe('uuid');
      expect(columns?.get('createdAt')).toBe('timestamp with time zone');
      expect(columns?.get('updatedAt')).toBe('timestamp with time zone');
    }
  });

  it('reverts every migration, leaving only the migrations table', async () => {
    while ((await dataSource.query<unknown[]>('SELECT 1 FROM migrations')).length > 0) {
      await dataSource.undoLastMigration({ transaction: 'each' });
    }
    expect(await tables()).toEqual(['migrations']);
  });

  it('applies again after a full revert', async () => {
    await dataSource.runMigrations({ transaction: 'each' });
    expect(await tables()).toContain('jira_connections');
    const sql = await dataSource.driver.createSchemaBuilder().log();
    expect(sql.upQueries.map((q) => q.query)).toEqual([]);
  });
});
