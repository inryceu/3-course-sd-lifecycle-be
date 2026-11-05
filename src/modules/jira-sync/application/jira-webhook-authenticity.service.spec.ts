import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JiraWebhookAuthenticityService } from './jira-webhook-authenticity.service';

const BODY = Buffer.from('{"webhookEvent":"jira:issue_updated"}');
const WEBHOOK_SECRET = 'webhook-secret-at-least-32-characters-long';
const CLIENT_ID = 'client-id';
const CLIENT_SECRET = 'client-secret';

function setup() {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'webhook') return { secret: WEBHOOK_SECRET };
      if (key === 'jira') return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
      throw new Error(`unexpected config ${key}`);
    }),
  };
  const jwt = new JwtService();
  const service = new JiraWebhookAuthenticityService(config as never, jwt);
  return { service, jwt };
}

function hmac(body = BODY, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function token(
  jwt: JwtService,
  options: {
    secret?: string;
    issuer?: string;
    expiresIn?: string;
    algorithm?: 'HS256' | 'HS512' | 'HS384';
  } = {},
): string {
  return jwt.sign(
    { sub: 'atlassian' },
    {
      secret: options.secret ?? CLIENT_SECRET,
      issuer: options.issuer ?? CLIENT_ID,
      algorithm: options.algorithm ?? 'HS256',
      expiresIn: options.expiresIn ?? '5m',
    },
  );
}

describe('JiraWebhookAuthenticityService', () => {
  it('accepts a valid HMAC signature over the raw body', () => {
    const { service } = setup();
    expect(() => service.verify(BODY, { 'x-hub-signature': hmac() })).not.toThrow();
  });

  it('rejects a signature computed from a re-encoded body', () => {
    const { service } = setup();
    const reencoded = Buffer.from(JSON.stringify(JSON.parse(BODY.toString()), null, 2));
    expect(() => service.verify(reencoded, { 'x-hub-signature': hmac(BODY) })).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid HS256 bearer token', () => {
    const { service, jwt } = setup();
    expect(() => service.verify(BODY, { authorization: `Bearer ${token(jwt)}` })).not.toThrow();
  });

  it('accepts a valid HS512 bearer token', () => {
    const { service, jwt } = setup();
    expect(() =>
      service.verify(BODY, { authorization: `Bearer ${token(jwt, { algorithm: 'HS512' })}` }),
    ).not.toThrow();
  });

  it('rejects a missing proof', () => {
    const { service } = setup();
    expect(() => service.verify(BODY, {})).toThrow(UnauthorizedException);
  });

  it('rejects a malformed signature header', () => {
    const { service } = setup();
    expect(() => service.verify(BODY, { 'x-hub-signature': 'sha1=deadbeef' })).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an invalid HMAC even when a valid JWT is also present', () => {
    const { service, jwt } = setup();
    expect(() =>
      service.verify(BODY, {
        'x-hub-signature': hmac(BODY, 'wrong-secret-at-least-32-characters'),
        authorization: `Bearer ${token(jwt)}`,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with another secret', () => {
    const { service, jwt } = setup();
    expect(() =>
      service.verify(BODY, {
        authorization: `Bearer ${token(jwt, { secret: 'another-secret-at-least-32-chars' })}`,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a token with a wrong issuer', () => {
    const { service, jwt } = setup();
    expect(() =>
      service.verify(BODY, {
        authorization: `Bearer ${token(jwt, { issuer: 'another-app' })}`,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a token with a disallowed algorithm', () => {
    const { service, jwt } = setup();
    expect(() =>
      service.verify(BODY, {
        authorization: `Bearer ${token(jwt, { algorithm: 'HS384' })}`,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an expired token', () => {
    const { service, jwt } = setup();
    expect(() =>
      service.verify(BODY, {
        authorization: `Bearer ${token(jwt, { expiresIn: '-1s' })}`,
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a non-Bearer authorization header', () => {
    const { service } = setup();
    expect(() => service.verify(BODY, { authorization: 'Basic abc' })).toThrow(
      UnauthorizedException,
    );
  });
});
