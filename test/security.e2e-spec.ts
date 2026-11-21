import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, PREFIX, uniqueEmail } from './helpers';

// Throttling is skipped in the other e2e suites (see AppModule); this one needs it on, and it
// runs "behind one proxy" so X-Forwarded-For identifies the client.
process.env['THROTTLE_SKIP'] = 'false';
process.env['TRUST_PROXY'] = '1';

describe('Security hardening (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // Each test uses its own forwarded client address, so the counters do not interfere.
  const from = (ip: string) => ({ 'X-Forwarded-For': ip });
  const register = (ip: string) =>
    request(server)
      .post(`${PREFIX}/auth/register`)
      .set(from(ip))
      .send({ email: uniqueEmail('rate'), password: 'long enough pw', displayName: 'Rate' });

  it('boots with the sanitizing logger installed and logs without recursing', () => {
    expect(() => new Logger('Probe').log('password=hunter2')).not.toThrow();
  });

  describe('rate limiting', () => {
    it('answers the 6th registration from one client with 429', async () => {
      for (let i = 0; i < 5; i++) await register('10.0.0.1').expect(201);
      await register('10.0.0.1').expect(429);
      // Behind the proxy another client has its own counter.
      await register('10.0.0.3').expect(201);
    });

    it('answers the 11th login from one client with 429', async () => {
      const login = () =>
        request(server)
          .post(`${PREFIX}/auth/login`)
          .set(from('10.0.0.2'))
          .send({ email: 'nobody@example.com', password: 'wrong password' });
      for (let i = 0; i < 10; i++) await login().expect(401);
      await login().expect(429);
    });

    it('does not throttle the Jira webhook or the health check', async () => {
      for (let i = 0; i < 105; i++) {
        const hook = await request(server).post(`${PREFIX}/jira/webhook`).send({});
        expect(hook.status).not.toBe(429);
      }
      for (let i = 0; i < 105; i++) {
        await request(server).get(`${PREFIX}/health`).expect(200);
      }
    });

    it('still throttles ordinary routes at the global limit', async () => {
      let last = 0;
      for (let i = 0; i < 101; i++) {
        last = (await request(server).get(`${PREFIX}/auth/me`).set(from('10.0.0.4'))).status;
      }
      expect(last).toBe(429);
    });
  });

  describe('security headers', () => {
    it('sends the default CSP and X-Frame-Options DENY on API routes', async () => {
      const res = await request(server).get(`${PREFIX}/health`).set(from('10.0.0.5')).expect(200);
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-xss-protection']).toBe('0');
    });
  });
});
