import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessibleResource,
  AtlassianOAuth,
  AtlassianTokens,
  JiraIssueFields,
  JiraIssueResponse,
  JiraTransitionResponse,
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

interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
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

  async createIssue(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    fields: JiraIssueFields;
  }): Promise<JiraIssueResponse> {
    const response = await this.jiraRequest(input.siteUrl, `/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields: input.fields }),
    });
    if (!response.ok) {
      this.logger.warn(`Create issue failed: HTTP ${response.status}`);
      if (response.status >= 500) {
        throw new AtlassianUnavailableError(`HTTP ${response.status}`);
      }
      const json = (await this.readJson(response)) as JiraErrorResponse;
      throw new AtlassianRejectedError(json.errorMessages?.[0] ?? 'create_failed', response.status);
    }
    return this.readJson(response) as Promise<JiraIssueResponse>;
  }

  async updateIssue(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
    fields: Partial<JiraIssueFields>;
  }): Promise<void> {
    const response = await this.jiraRequest(input.siteUrl, `/rest/api/3/issue/${input.issueKey}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields: input.fields }),
    });
    if (!response.ok) {
      this.logger.warn(`Update issue failed: HTTP ${response.status}`);
      if (response.status >= 500) {
        throw new AtlassianUnavailableError(`HTTP ${response.status}`);
      }
      const json = (await this.readJson(response)) as JiraErrorResponse;
      throw new AtlassianRejectedError(json.errorMessages?.[0] ?? 'update_failed', response.status);
    }
  }

  async getTransitions(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
  }): Promise<JiraTransitionResponse> {
    const response = await this.jiraRequest(
      input.siteUrl,
      `/rest/api/3/issue/${input.issueKey}/transitions`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
      },
    );
    if (!response.ok) {
      this.logger.warn(`Get transitions failed: HTTP ${response.status}`);
      if (response.status >= 500) {
        throw new AtlassianUnavailableError(`HTTP ${response.status}`);
      }
      const json = (await this.readJson(response)) as JiraErrorResponse;
      throw new AtlassianRejectedError(
        json.errorMessages?.[0] ?? 'transitions_failed',
        response.status,
      );
    }
    return this.readJson(response) as Promise<JiraTransitionResponse>;
  }

  async transitionIssue(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
    transitionId: string;
  }): Promise<void> {
    const response = await this.jiraRequest(
      input.siteUrl,
      `/rest/api/3/issue/${input.issueKey}/transitions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ transition: { id: input.transitionId } }),
      },
    );
    if (!response.ok) {
      this.logger.warn(`Transition issue failed: HTTP ${response.status}`);
      if (response.status >= 500) {
        throw new AtlassianUnavailableError(`HTTP ${response.status}`);
      }
      const json = (await this.readJson(response)) as JiraErrorResponse;
      throw new AtlassianRejectedError(
        json.errorMessages?.[0] ?? 'transition_failed',
        response.status,
      );
    }
  }

  async addComment(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
    body: string;
  }): Promise<void> {
    const response = await this.jiraRequest(
      input.siteUrl,
      `/rest/api/3/issue/${input.issueKey}/comment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: input.body }] }],
          },
        }),
      },
    );
    if (!response.ok) {
      this.logger.warn(`Add comment failed: HTTP ${response.status}`);
      if (response.status >= 500) {
        throw new AtlassianUnavailableError(`HTTP ${response.status}`);
      }
      const json = (await this.readJson(response)) as JiraErrorResponse;
      throw new AtlassianRejectedError(
        json.errorMessages?.[0] ?? 'comment_failed',
        response.status,
      );
    }
  }

  private async jiraRequest(siteUrl: string, path: string, init: RequestInit): Promise<Response> {
    const url = `${siteUrl.replace(/\/+$/, '')}${path}`;
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'network error';
      this.logger.warn(`Jira request failed: ${reason}`);
      throw new AtlassianUnavailableError(reason);
    }
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
