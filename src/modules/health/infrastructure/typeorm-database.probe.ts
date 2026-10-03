import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DatabaseProbe } from '../application/database-probe.port';

const PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class TypeOrmDatabaseProbe implements DatabaseProbe {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isUp(): Promise<boolean> {
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('database probe timed out')), PROBE_TIMEOUT_MS).unref(),
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
