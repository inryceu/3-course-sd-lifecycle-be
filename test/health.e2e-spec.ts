import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return health status', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeDefined();
    });
  });
});
