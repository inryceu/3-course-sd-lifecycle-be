import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DATABASE_PROBE } from '../src/modules/health/application/database-probe.port';
import { PREFIX } from './helpers';

// Every response is also validated against docs/api/openapi.yaml (test/openapi-setup.ts).
describe('Health probes (e2e)', () => {
  let app: INestApplication;
  let databaseUp = true;

  beforeAll(async () => {
    // The probe is switchable so readiness can be driven to 503 without stopping Postgres.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_PROBE)
      .useValue({ isUp: () => Promise.resolve(databaseUp) })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    databaseUp = true;
  });

  it('answers liveness without authentication and without a database field', async () => {
    const res = await request(app.getHttpServer()).get(`${PREFIX}/health/alive`).expect(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(res.body).not.toHaveProperty('database');
  });

  it('stays alive while the database is down', async () => {
    databaseUp = false;
    await request(app.getHttpServer()).get(`${PREFIX}/health/alive`).expect(200);
  });

  it('answers readiness 200 when the database is up', async () => {
    const res = await request(app.getHttpServer()).get(`${PREFIX}/health/ready`).expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('answers readiness 503 when the database is down', async () => {
    databaseUp = false;
    const res = await request(app.getHttpServer()).get(`${PREFIX}/health/ready`).expect(503);
    expect(res.body).toMatchObject({ status: 'error', database: 'down' });
  });
});
