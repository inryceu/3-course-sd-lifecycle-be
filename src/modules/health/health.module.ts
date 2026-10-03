import { Module } from '@nestjs/common';
import { DATABASE_PROBE } from './application/database-probe.port';
import { HealthService } from './application/health.service';
import { TypeOrmDatabaseProbe } from './infrastructure/typeorm-database.probe';
import { HealthController } from './presentation/health.controller';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    TypeOrmDatabaseProbe,
    { provide: DATABASE_PROBE, useExisting: TypeOrmDatabaseProbe },
  ],
})
export class HealthModule {}
