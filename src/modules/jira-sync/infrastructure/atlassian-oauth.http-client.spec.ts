import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { Logger } from '@nestjs/common';
import { AtlassianRejectedError, AtlassianUnavailableError } from '../domain/errors';
import { AtlassianOAuthHttpClient } from './atlassian-oauth.http-client';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Responder = (request: Recorded) => { status: number; body?: unknown };

let server: Server;
let baseUrl: string;
let requests: Recorded[];
let respond: Responder;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const recorded: Recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      const { status, body } = respond(recorded);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  requests = [];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const client = (overrides: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    'jira.clientId': 'client-id',
    'jira.clientSecret': 'client-secret',
    'jira.redirectUri': 'http://localhost:5173/jira/callback',
    'jira.authBaseUrl': baseUrl,
    'jira.apiBaseUrl': baseUrl,
    ...overrides,
  };
  return new AtlassianOAuthHttpClient({ getOrThrow: (key: string) => values[key] } as never);
};

describe('AtlassianOAuthHttpClient.exchangeCode', () => {
  it('posts the authorization-code grant with the PKCE verifier and maps the response', async () => {
    respond = () => ({
      status: 200,
      body: {
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        scope: 'read:jira-work offline_access',
      },
    });

    const tokens = await client().exchangeCode({ code: 'the-code', codeVerifier: 'the-verifier' });

    expect(tokens).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
      scopes: ['read:jira-work', 'offline_access'],
    });
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('/oauth/token');
    expect(JSON.parse(requests[0].body)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'the-code',
      redirect_uri: 'http://localhost:5173/jira/callback',
      code_verifier: 'the-verifier',
    });
  });

  it('maps a missing refresh token to null', async () => {
    respond = () => ({ status: 200, body: { access_token: 'a', expires_in: 60 } });
    const tokens = await client().exchangeCode({ code: 'c', codeVerifier: 'v' });
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.scopes).toEqual([]);
  });

  it('reports a rejected code as AtlassianRejectedError with the provider error', async () => {
    respond = () => ({ status: 403, body: { error: 'invalid_grant' } });
    const failure = client().exchangeCode({ code: 'c', codeVerifier: 'v' });
    await expect(failure).rejects.toBeInstanceOf(AtlassianRejectedError);
    await expect(failure).rejects.toMatchObject({ providerError: 'invalid_grant', status: 403 });
  });

  it('reports a provider outage as AtlassianUnavailableError', async () => {
    respond = () => ({ status: 503, body: {} });
    await expect(client().exchangeCode({ code: 'c', codeVerifier: 'v' })).rejects.toBeInstanceOf(
      AtlassianUnavailableError,
    );
  });

  it('reports an unreachable provider as AtlassianUnavailableError', async () => {
    const unreachable = client({ 'jira.authBaseUrl': 'http://127.0.0.1:1' });
    await expect(unreachable.exchangeCode({ code: 'c', codeVerifier: 'v' })).rejects.toBeInstanceOf(
      AtlassianUnavailableError,
    );
  });

  it('rejects a success response without an access token', async () => {
    respond = () => ({ status: 200, body: {} });
    await expect(client().exchangeCode({ code: 'c', codeVerifier: 'v' })).rejects.toBeInstanceOf(
      AtlassianUnavailableError,
    );
  });

  it('never logs the code, verifier, secret or tokens', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    respond = () => ({ status: 403, body: { error: 'invalid_grant' } });

    await client()
      .exchangeCode({ code: 'secret-code', codeVerifier: 'secret-verifier' })
      .catch(() => undefined);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('invalid_grant');
    expect(logged).not.toMatch(/secret-code|secret-verifier|client-secret/);
  });
});

describe('AtlassianOAuthHttpClient.listAccessibleResources', () => {
  it('sends the bearer token and maps the sites', async () => {
    respond = () => ({
      status: 200,
      body: [
        {
          id: 'cloud-1',
          url: 'https://acme.atlassian.net',
          name: 'Acme',
          scopes: ['read:jira-work'],
        },
      ],
    });

    const resources = await client().listAccessibleResources('access-token');

    expect(resources).toEqual([
      {
        id: 'cloud-1',
        url: 'https://acme.atlassian.net',
        name: 'Acme',
        scopes: ['read:jira-work'],
      },
    ]);
    expect(requests[0].url).toBe('/oauth/token/accessible-resources');
    expect(requests[0].headers.authorization).toBe('Bearer access-token');
  });

  it('reports 401 as rejected and 5xx as unavailable', async () => {
    respond = () => ({ status: 401, body: {} });
    await expect(client().listAccessibleResources('t')).rejects.toBeInstanceOf(
      AtlassianRejectedError,
    );
    respond = () => ({ status: 500, body: {} });
    await expect(client().listAccessibleResources('t')).rejects.toBeInstanceOf(
      AtlassianUnavailableError,
    );
  });

  it('rejects a body that is not a list', async () => {
    respond = () => ({ status: 200, body: { nope: true } });
    await expect(client().listAccessibleResources('t')).rejects.toBeInstanceOf(
      AtlassianUnavailableError,
    );
  });
});
