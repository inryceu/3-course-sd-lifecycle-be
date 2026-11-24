import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { HealthService } from '../application/health.service';
import { HealthStatus } from '../domain/health-status';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database readiness' })
  @ApiResponse({ status: 200, description: 'Service and database are up' })
  @ApiResponse({ status: 503, description: 'Database is not reachable' })
  async check(): Promise<HealthStatus> {
    const status = await this.health.ready();
    if (status.status !== 'ok') {
      throw new HttpException(status, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return status;
  }

  @Public()
  @Get('alive')
  @ApiOperation({ summary: 'Liveness probe (process only, no DB check)' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  alive(): HealthStatus {
    return this.health.alive();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (database reachable)' })
  @ApiResponse({ status: 200, description: 'Service and database are up' })
  @ApiResponse({ status: 503, description: 'Database is not reachable' })
  async ready(): Promise<HealthStatus> {
    const status = await this.health.ready();
    if (status.status !== 'ok') {
      throw new HttpException(status, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return status;
  }
}
