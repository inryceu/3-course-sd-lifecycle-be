import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IncomingHttpHeaders } from 'http';
import { JiraConfig, WebhookConfig } from '../../../config/configuration';

interface AtlassianWebhookClaims {
  readonly exp?: unknown;
  readonly iss?: unknown;
}

@Injectable()
export class JiraWebhookAuthenticityService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  verify(rawBody: Buffer, headers: IncomingHttpHeaders): void {
    const signature = headerValue(headers['x-hub-signature']);
    if (signature !== undefined) {
      this.verifyHmac(rawBody, signature);
      return;
    }

    const authorization = headerValue(headers.authorization);
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing webhook authenticity proof');
    }
    this.verifyJwt(authorization.slice('Bearer '.length).trim());
  }

  private verifyHmac(rawBody: Buffer, signature: string): void {
    if (!signature.startsWith('sha256=')) {
      throw new UnauthorizedException('Unsupported webhook signature');
    }
    const received = Buffer.from(signature.slice('sha256='.length), 'hex');
    const expected = createHmac('sha256', this.config.getOrThrow<WebhookConfig>('webhook').secret)
      .update(rawBody)
      .digest();
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private verifyJwt(token: string): void {
    if (token.length === 0) {
      throw new UnauthorizedException('Missing webhook authenticity proof');
    }
    const jira = this.config.getOrThrow<JiraConfig>('jira');
    let claims: AtlassianWebhookClaims;
    try {
      claims = this.jwt.verify<AtlassianWebhookClaims>(token, {
        secret: jira.clientSecret,
        algorithms: ['HS256', 'HS512'],
        issuer: jira.clientId,
      });
    } catch {
      throw new UnauthorizedException('Invalid webhook token');
    }
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Invalid webhook token');
    }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
