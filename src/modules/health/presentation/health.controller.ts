import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { HealthService } from '../application/health.service';
import { HealthStatus } from '../domain/health-status';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database readiness' })
  @ApiResponse({ status: 200, description: 'Service and database are up' })
  @ApiResponse({ status: 503, description: 'Database is not reachable' })
  async check(): Promise<HealthStatus> {
    const status = await this.health.check();
    if (status.status !== 'ok') {
      throw new HttpException(status, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return status;
  }
}
