import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessibleResource,
  AtlassianOAuth,
  AtlassianTokens,
} from '../application/atlassian-oauth.port';
import { AtlassianRejectedError, AtlassianUnavailableError } from '../domain/errors';

const TIMEOUT_MS = 10_000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

/**
 * Talks to Atlassian with the global `fetch`. Base URLs come from configuration so tests can use a
 * stub server. Request and response bodies (codes, tokens, client secret) are never logged; only
 * the status and the provider error code are.
 */
@Injectable()
export class AtlassianOAuthHttpClient implements AtlassianOAuth {
  private readonly logger = new Logger(AtlassianOAuthHttpClient.name);

  constructor(private readonly config: ConfigService) {}

  async exchangeCode(input: { code: string; codeVerifier: string }): Promise<AtlassianTokens> {
    const body = {
      grant_type: 'authorization_code',
      client_id: this.config.getOrThrow<string>('jira.clientId'),
      client_secret: this.config.getOrThrow<string>('jira.clientSecret'),
      code: input.code,
      redirect_uri: this.config.getOrThrow<string>('jira.redirectUri'),
      code_verifier: input.codeVerifier,
    };
    const response = await this.request(`${this.authBase()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await this.readJson(response)) as TokenResponse;

    if (!response.ok) {
      this.logger.warn(`Token exchange failed: HTTP ${response.status} ${json.error ?? ''}`.trim());
      if (response.status >= 500) {
        throw new AtlassianUnavailableError(`HTTP ${response.status}`);
      }
      throw new AtlassianRejectedError(json.error ?? 'invalid_request', response.status);
    }
    if (!json.access_token || typeof json.expires_in !== 'number') {
      throw new AtlassianUnavailableError('unexpected token response');
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresIn: json.expires_in,
      scopes: (json.scope ?? '').split(' ').filter((scope) => scope.length > 0),
    };
  }

  async listAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
    const response = await this.request(`${this.apiBase()}/oauth/token/accessible-resources`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      this.logger.warn(`Accessible resources failed: HTTP ${response.status}`);
      if (response.status >= 500) {
        throw new AtlassianUnavailableError(`HTTP ${response.status}`);
      }
      throw new AtlassianRejectedError('resources_rejected', response.status);
    }
    const json = await this.readJson(response);
    if (!Array.isArray(json)) {
      throw new AtlassianUnavailableError('unexpected resources response');
    }
    return json
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: String(item['id']),
        url: String(item['url']),
        name: String(item['name'] ?? ''),
        scopes: Array.isArray(item['scopes']) ? item['scopes'].map(String) : [],
      }));
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'network error';
      this.logger.warn(`Atlassian request failed: ${reason}`);
      throw new AtlassianUnavailableError(reason);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private authBase(): string {
    return this.config.getOrThrow<string>('jira.authBaseUrl').replace(/\/+$/, '');
  }

  private apiBase(): string {
    return this.config.getOrThrow<string>('jira.apiBaseUrl').replace(/\/+$/, '');
  }
}
