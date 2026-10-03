import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports ok when the database is up', async () => {
    const service = new HealthService({ isUp: () => Promise.resolve(true) });
    const status = await service.check();
    expect(status.status).toBe('ok');
    expect(status.database).toBe('up');
    expect(typeof status.uptime).toBe('number');
    expect(Number.isNaN(Date.parse(status.timestamp))).toBe(false);
  });

  it('reports error when the database is down', async () => {
    const service = new HealthService({ isUp: () => Promise.resolve(false) });
    const status = await service.check();
    expect(status.status).toBe('error');
    expect(status.database).toBe('down');
  });
});
