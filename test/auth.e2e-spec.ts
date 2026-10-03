import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bearer, createTestApp, PREFIX, registerUser, uniqueEmail } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: object) => request(server).post(`${PREFIX}${path}`).send(body);

  describe('POST /auth/register', () => {
    it('creates an account and returns token, lifetime and user without password data', async () => {
      const email = uniqueEmail();

      const response = await post('/auth/register', {
        email,
        password: 'long enough pw',
        displayName: 'Ann',
      }).expect(201);

      const body = response.body as Record<string, unknown>;
      expect(body).toEqual({
        accessToken: expect.any(String),
        expiresIn: expect.any(Number),
        user: { id: expect.any(String), email, displayName: 'Ann' },
      });
      expect(body['expiresIn']).toBeLessThanOrEqual(3600);
      expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
    });

    it('stores a bcrypt hash with cost >= 10, not the password', async () => {
      const email = uniqueEmail();
      await post('/auth/register', {
        email,
        password: 'long enough pw',
        displayName: 'Hash',
      }).expect(201);

      const [row] = await dataSource.query<{ passwordHash: string }[]>(
        'SELECT "passwordHash" FROM users WHERE email = $1',
        [email],
      );

      expect(row.passwordHash).not.toContain('long enough pw');
      expect(row.passwordHash).toMatch(/^\$2[aby]\$(1\d)\$/);
      expect(await bcrypt.compare('long enough pw', row.passwordHash)).toBe(true);
    });

    it('rejects a duplicate e-mail regardless of letter case with 409', async () => {
      const email = uniqueEmail('Dup');
      await post('/auth/register', { email, password: 'long enough pw', displayName: 'A' }).expect(
        201,
      );

      await post('/auth/register', {
        email: email.toUpperCase(),
        password: 'long enough pw',
        displayName: 'B',
      }).expect(409);
    });

    it('lets exactly one of concurrent registrations for the same e-mail succeed', async () => {
      const email = uniqueEmail('race');
      const send = () =>
        post('/auth/register', { email, password: 'long enough pw', displayName: 'R' });

      const statuses = (await Promise.all([send(), send(), send()])).map((r) => r.status).sort();

      expect(statuses).toEqual([201, 409, 409]);
    });

    it.each([
      ['short password', { password: 'short' }],
      ['password above 72 characters', { password: 'x'.repeat(73) }],
      ['invalid e-mail', { email: 'not-an-email' }],
      ['empty display name', { displayName: '   ' }],
      ['unknown field', { role: 'ADMIN' }],
    ])('rejects %s with 400 and creates nothing', async (_label, override) => {
      const email = uniqueEmail();
      await post('/auth/register', {
        email,
        password: 'long enough pw',
        displayName: 'Valid',
        ...override,
      }).expect(400);

      const rows = await dataSource.query<unknown[]>('SELECT 1 FROM users WHERE email = $1', [
        email,
      ]);
      expect(rows).toHaveLength(0);
    });
  });

  describe('POST /auth/login', () => {
    it('returns a token for correct credentials', async () => {
      const email = uniqueEmail('login');
      await post('/auth/register', { email, password: 'long enough pw', displayName: 'L' });

      const response = await post('/auth/login', { email, password: 'long enough pw' }).expect(200);

      expect(response.body).toMatchObject({ accessToken: expect.any(String), user: { email } });
    });

    it('answers 401 with the same message for a wrong password and an unknown e-mail', async () => {
      const email = uniqueEmail('login');
      await post('/auth/register', { email, password: 'long enough pw', displayName: 'L' });

      const wrongPassword = await post('/auth/login', { email, password: 'wrong password' }).expect(
        401,
      );
      const unknown = await post('/auth/login', {
        email: uniqueEmail('ghost'),
        password: 'whatever pw',
      }).expect(401);

      expect((wrongPassword.body as { message: string }).message).toBe('Invalid credentials');
      expect((unknown.body as { message: string }).message).toBe('Invalid credentials');
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user for a valid token', async () => {
      const user = await registerUser(app, 'me');

      const response = await request(server).get(`${PREFIX}/auth/me`).set(bearer(user)).expect(200);

      expect(response.body).toEqual({ id: user.id, email: user.email, displayName: 'me' });
    });

    it('answers 401 without a token', async () => {
      await request(server).get(`${PREFIX}/auth/me`).expect(401);
    });

    it('answers 401 for a malformed or tampered token', async () => {
      const user = await registerUser(app);
      await request(server)
        .get(`${PREFIX}/auth/me`)
        .set('Authorization', 'Bearer not-a-token')
        .expect(401);
      await request(server)
        .get(`${PREFIX}/auth/me`)
        .set('Authorization', `Bearer ${user.token.slice(0, -4)}AAAA`)
        .expect(401);
    });

    it('answers 401 for an expired token', async () => {
      const user = await registerUser(app);
      const jwt = app.get(JwtService);
      const expired = jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '-1s' });

      await request(server)
        .get(`${PREFIX}/auth/me`)
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('issues tokens that last at most one hour', async () => {
      const user = await registerUser(app);
      const claims = app
        .get(JwtService)
        .decode<{ iat: number; exp: number; sub: string }>(user.token);
      expect(claims.sub).toBe(user.id);
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    });

    it('answers 401 when the account behind a valid token no longer exists', async () => {
      const user = await registerUser(app, 'gone');
      await dataSource.query('DELETE FROM users WHERE id = $1', [user.id]);

      await request(server).get(`${PREFIX}/auth/me`).set(bearer(user)).expect(401);
    });
  });

  describe('protected by default', () => {
    it('answers 401 on a protected route without a token', async () => {
      await request(server).get(`${PREFIX}/boards`).expect(401);
    });

    it('keeps health public', async () => {
      const response = await request(server).get(`${PREFIX}/health`).expect(200);
      expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
    });

    it.each(['refresh', 'logout', 'profile'])('no longer exposes /auth/%s', async (name) => {
      const user = await registerUser(app);
      const res = await request(server).post(`${PREFIX}/auth/${name}`).set(bearer(user));
      expect(res.status).toBe(404);
    });
  });
});
