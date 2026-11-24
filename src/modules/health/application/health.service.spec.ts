import { HealthService } from './health.service';

describe('HealthService', () => {
  describe('alive', () => {
    it('reports ok when the process is running, without checking the database', () => {
      const isUp = jest.fn(() => Promise.resolve(false));
      const service = new HealthService({ isUp });
      const status = service.alive();
      expect(status.status).toBe('ok');
      expect(status).not.toHaveProperty('database');
      expect(typeof status.uptime).toBe('number');
      expect(Number.isNaN(Date.parse(status.timestamp))).toBe(false);
      expect(isUp).not.toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('reports ok when the database is up', async () => {
      const service = new HealthService({ isUp: () => Promise.resolve(true) });
      const status = await service.ready();
      expect(status.status).toBe('ok');
      expect(status.database).toBe('up');
      expect(typeof status.uptime).toBe('number');
      expect(Number.isNaN(Date.parse(status.timestamp))).toBe(false);
    });

    it('reports error when the database is down', async () => {
      const service = new HealthService({ isUp: () => Promise.resolve(false) });
      const status = await service.ready();
      expect(status.status).toBe('error');
      expect(status.database).toBe('down');
    });
  });
});
