import { createHash } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BoardRole } from '../src/modules/boards';
import { BoardMembershipEntity } from '../src/modules/boards/infrastructure/persistence/board-membership.entity';
import {
  bearer,
  BoardBody,
  createBoard,
  createTestApp,
  PREFIX,
  registerUser,
  TestUser,
} from './helpers';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, string>;
}

/**
 * Stand-in for Atlassian: auth.atlassian.com (/oauth/token) and api.atlassian.com
 * (/oauth/token/accessible-resources) on one local server.
 */
class AtlassianStub {
  readonly seen: Seen[] = [];
  private server!: Server;
  url!: string;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? (JSON.parse(raw) as Record<string, string>) : {};
        this.seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        const [status, payload] = this.handle(req, body);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, body: Record<string, string>): [number, unknown] {
    if (req.method === 'POST' && req.url === '/oauth/token') {
      switch (body['code']) {
        case 'good-code':
          return [
            200,
            {
              access_token: 'access-from-stub',
              refresh_token: 'refresh-from-stub',
              expires_in: 3600,
              scope: 'read:jira-work write:jira-work offline_access',
            },
          ];
        case 'no-site-code':
          return [200, { access_token: 'no-site-token', expires_in: 60, scope: 'read:jira-work' }];
        case 'down-code':
          return [503, { error: 'server_error' }];
        default:
          return [403, { error: 'invalid_grant' }];
      }
    }
    if (req.method === 'GET' && req.url === '/oauth/token/accessible-resources') {
      if (req.headers.authorization === 'Bearer no-site-token') return [200, []];
      return [
        200,
        [
          {
            id: 'cloud-123',
            url: 'https://acme.atlassian.net',
            name: 'Acme',
            scopes: ['read:jira-work'],
          },
        ],
      ];
    }
    return [404, {}];
  }
}

describe('Jira OAuth 2.0 (3LO) connection (e2e)', () => {
  const stub = new AtlassianStub();
  let app: INestApplication;
  let dataSource: DataSource;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    await stub.start();
    process.env['JIRA_AUTH_BASE_URL'] = stub.url;
    process.env['JIRA_API_BASE_URL'] = stub.url;
    app = await createTestApp();
    dataSource = app.get(DataSource);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await stub.stop();
    delete process.env['JIRA_AUTH_BASE_URL'];
    delete process.env['JIRA_API_BASE_URL'];
  });

  const get = (user: TestUser, path: string) =>
    request(server).get(`${PREFIX}${path}`).set(bearer(user));

  async function setup(): Promise<{ admin: TestUser; board: BoardBody }> {
    const admin = await registerUser(app, 'admin');
    return { admin, board: await createBoard(app, admin) };
  }

  async function start(user: TestUser, boardId: string) {
    const response = await get(user, `/jira/oauth/start?boardId=${boardId}`).expect(200);
    const { authorizeUrl } = response.body as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    return { url, state: url.searchParams.get('state') };
  }

  const callback = (user: TestUser, query: Record<string, string>) =>
    get(user, `/jira/oauth/callback?${new URLSearchParams(query).toString()}`);

  describe('start', () => {
    it('returns the authorise URL with state and a PKCE S256 challenge and stores them for 10 minutes', async () => {
      const { admin, board } = await setup();

      const { url, state } = await start(admin, board.id);

      expect(url.origin).toBe(stub.url);
      expect(url.pathname).toBe('/authorize');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/jira/callback');
      expect(url.searchParams.get('scope')).toContain('offline_access');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const [row] = await dataSource.query<{ expiresAt: Date; codeVerifierEnc: string }[]>(
        'SELECT "expiresAt", "codeVerifierEnc" FROM jira_oauth_states WHERE state = $1',
        [state],
      );
      const ttl = row.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(9 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
      expect(row.codeVerifierEnc.startsWith('v1.')).toBe(true);
    });

    it('is Admin only: 403 for a member, 404 for a stranger, 401 without a token, 400 for a bad id', async () => {
      const { admin, board } = await setup();
      const member = await registerUser(app, 'member');
      const stranger = await registerUser(app, 'stranger');
      await dataSource
        .getRepository(BoardMembershipEntity)
        .insert({ boardId: board.id, userId: member.id, role: BoardRole.MEMBER });

      await get(member, `/jira/oauth/start?boardId=${board.id}`).expect(403);
      await get(stranger, `/jira/oauth/start?boardId=${board.id}`).expect(404);
      await request(server).get(`${PREFIX}/jira/oauth/start?boardId=${board.id}`).expect(401);
      await get(admin, '/jira/oauth/start?boardId=nope').expect(400);
      await get(admin, '/jira/oauth/start').expect(400);
    });
  });

  describe('callback', () => {
    it('connects the board: PKCE verifier matches, tokens are stored encrypted and never returned', async () => {
      const { admin, board } = await setup();
      const { url, state } = await start(admin, board.id);

      const response = await callback(admin, { code: 'good-code', state }).expect(200);

      expect(response.body).toEqual({
        connected: true,
        cloudId: 'cloud-123',
        siteUrl: 'https://acme.atlassian.net',
      });

      // The verifier sent to Atlassian hashes to the challenge announced in the authorise URL.
      const exchange = stub.seen.filter((s) => s.url === '/oauth/token').pop();
      expect(exchange.body['code_verifier']).toBeDefined();
      expect(createHash('sha256').update(exchange.body['code_verifier']).digest('base64url')).toBe(
        url.searchParams.get('code_challenge'),
      );
      expect(exchange.body).toMatchObject({
        grant_type: 'authorization_code',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        redirect_uri: 'http://localhost:5173/jira/callback',
      });
      expect(stub.seen.at(-1)?.headers.authorization).toBe('Bearer access-from-stub');

      const [stored] = await dataSource.query<Record<string, unknown>[]>(
        'SELECT * FROM jira_connections WHERE board_id = $1',
        [board.id],
      );
      expect(stored).toMatchObject({
        cloudId: 'cloud-123',
        siteUrl: 'https://acme.atlassian.net',
        connected_by_id: admin.id,
        scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
      });
      const everything = JSON.stringify(stored);
      expect(everything).not.toContain('access-from-stub');
      expect(everything).not.toContain('refresh-from-stub');
      expect(String(stored['accessTokenEnc'])).toMatch(/^v1\./);
      expect(String(stored['refreshTokenEnc'])).toMatch(/^v1\./);
      const ttl = (stored['expiresAt'] as Date).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(3500 * 1000);
    });

    it('replaces the credentials when the board is connected again', async () => {
      const { admin, board } = await setup();
      for (const _ of [1, 2]) {
        const { state } = await start(admin, board.id);
        await callback(admin, { code: 'good-code', state }).expect(200);
      }
      const rows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM jira_connections WHERE board_id = $1',
        [board.id],
      );
      expect(rows).toHaveLength(1);
    });

    it('rejects an unknown state with 400 and stores nothing', async () => {
      const { admin, board } = await setup();
      await callback(admin, { code: 'good-code', state: 'a'.repeat(64) }).expect(400);
      await callback(admin, { code: 'good-code' }).expect(400);
      const rows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM jira_connections WHERE board_id = $1',
        [board.id],
      );
      expect(rows).toHaveLength(0);
    });

    it('rejects an expired state with 400', async () => {
      const { admin, board } = await setup();
      const { state } = await start(admin, board.id);
      await dataSource.query(
        `UPDATE jira_oauth_states SET "expiresAt" = now() - interval '1 minute' WHERE state = $1`,
        [state],
      );
      const before = stub.seen.length;

      await callback(admin, { code: 'good-code', state }).expect(400);

      expect(stub.seen).toHaveLength(before);
    });

    it('cannot be replayed', async () => {
      const { admin, board } = await setup();
      const { state } = await start(admin, board.id);
      await callback(admin, { code: 'good-code', state }).expect(200);

      await callback(admin, { code: 'good-code', state }).expect(400);
    });

    it('rejects another user presenting the state and leaves it usable for its owner', async () => {
      const { admin, board } = await setup();
      const intruder = await registerUser(app, 'intruder');
      const { state } = await start(admin, board.id);

      await callback(intruder, { code: 'good-code', state }).expect(400);
      await callback(admin, { code: 'good-code', state }).expect(200);
    });

    it('turns a denied consent into 400, discards the state and stores nothing', async () => {
      const { admin, board } = await setup();
      const { state } = await start(admin, board.id);

      const response = await callback(admin, { state, error: 'access_denied' }).expect(400);

      expect((response.body as { message: string }).message).toContain('access_denied');
      await callback(admin, { code: 'good-code', state }).expect(400);
      const rows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM jira_connections WHERE board_id = $1',
        [board.id],
      );
      expect(rows).toHaveLength(0);
    });

    it('answers 400 when Atlassian rejects the code, 502 when it is down, 400 when there is no site', async () => {
      const { admin, board } = await setup();

      let { state } = await start(admin, board.id);
      await callback(admin, { code: 'bad-code', state }).expect(400);

      ({ state } = await start(admin, board.id));
      await callback(admin, { code: 'down-code', state }).expect(502);

      ({ state } = await start(admin, board.id));
      const noSite = await callback(admin, { code: 'no-site-code', state }).expect(400);
      expect((noSite.body as { message: string }).message).toMatch(/no accessible Jira site/);

      const rows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM jira_connections WHERE board_id = $1',
        [board.id],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('connection status and disconnect', () => {
    it('shows the status to any member without tokens, and lets only the Admin disconnect', async () => {
      const { admin, board } = await setup();
      const viewer = await registerUser(app, 'viewer');
      const stranger = await registerUser(app, 'stranger');
      await dataSource
        .getRepository(BoardMembershipEntity)
        .insert({ boardId: board.id, userId: viewer.id, role: BoardRole.VIEWER });

      const before = await get(viewer, `/jira/connection?boardId=${board.id}`).expect(200);
      expect(before.body).toMatchObject({ connected: false, boardId: board.id });

      const { state } = await start(admin, board.id);
      await callback(admin, { code: 'good-code', state }).expect(200);

      const status = await get(viewer, `/jira/connection?boardId=${board.id}`).expect(200);
      expect(status.body).toMatchObject({
        connected: true,
        cloudId: 'cloud-123',
        siteUrl: 'https://acme.atlassian.net',
        scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
      });
      expect(JSON.stringify(status.body)).not.toMatch(/token|access-from-stub|v1\./i);
      await get(stranger, `/jira/connection?boardId=${board.id}`).expect(404);

      await request(server)
        .delete(`${PREFIX}/jira/connection?boardId=${board.id}`)
        .set(bearer(viewer))
        .expect(403);
      await request(server)
        .delete(`${PREFIX}/jira/connection?boardId=${board.id}`)
        .set(bearer(admin))
        .expect(204);

      const after = await get(viewer, `/jira/connection?boardId=${board.id}`).expect(200);
      expect(after.body).toMatchObject({ connected: false });
      const rows = await dataSource.query<unknown[]>(
        'SELECT 1 FROM jira_connections WHERE board_id = $1',
        [board.id],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('no longer exposes the unauthenticated stub endpoints', async () => {
    const { admin } = await setup();
    await get(admin, '/jira-sync/board/some-board').expect(404);
  });
});
