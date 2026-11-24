import { Inject, Injectable } from '@nestjs/common';
import { HealthStatus, LivenessStatus } from '../domain/health-status';
import { DATABASE_PROBE, DatabaseProbe } from './database-probe.port';

@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE_PROBE) private readonly database: DatabaseProbe) {}

  alive(): LivenessStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  async ready(): Promise<HealthStatus> {
    const databaseUp = await this.database.isUp();
    return {
      status: databaseUp ? 'ok' : 'error',
      database: databaseUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
