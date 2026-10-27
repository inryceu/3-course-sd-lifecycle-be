import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ATLASSIAN_OAUTH,
  AtlassianOAuth,
  AtlassianTokens,
} from '../application/atlassian-oauth.port';
import {
  AddCommentInput,
  AddCommentResult,
  DEFAULT_SEARCH_FIELDS,
  DoTransitionInput,
  GetCommentsInput,
  GetCommentsResult,
  JiraComment,
  JiraGateway,
  JiraIssue,
  JiraProject,
  JiraStatus,
  JiraTransition,
  ListProjectsInput,
  ListProjectStatusesInput,
  ListTransitionsInput,
  ListTransitionsResult,
  ListWebhooksInput,
  ListWebhooksResult,
  RegisterWebhookInput,
  RegisterWebhookResult,
  RefreshWebhooksInput,
  RefreshWebhooksResult,
  SearchIssuesInput,
  SearchIssuesResult,
} from '../application/jira-gateway.port';
import { TOKEN_CIPHER, TokenCipher } from '../application/token-cipher.port';
import { AtlassianRejectedError, AtlassianUnavailableError } from '../domain/errors';
import {
  JiraClientError,
  JiraGatewayError,
  JiraPersistenceError,
  JiraRateLimitedError,
  JiraServerError,
  JiraTimeBudgetExceededError,
  JiraTimeoutError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';
import { JiraConnectionEntity } from './persistence/jira-connection.entity';

/** Injection token for optional gateway tuning used by tests. */
export const JIRA_GATEWAY_OPTIONS = Symbol('JIRA_GATEWAY_OPTIONS');

/** Optional gateway knobs; production uses the documented defaults. */
export interface JiraGatewayOptions {
  /** Per-request timeout in milliseconds (default 10s). */
  readonly timeoutMs?: number;
  /** Per-public-call budget in milliseconds (default 45s). */
  readonly timeBudgetMs?: number;
  /** Sleep implementation, injectable for deterministic tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Clock in epoch milliseconds, injectable for tests. */
  readonly now?: () => number;
  /** Uniform random source for jitter, injectable for tests. */
  readonly random?: () => number;
}

const JIRA_GATEWAY_TIMEOUT_MS = 10_000;
const JIRA_GATEWAY_TIME_BUDGET_MS = 45_000;
const REFRESH_WINDOW_MS = 60_000;
const MAX_RETRY_AFTER_SECONDS = 60;
const CONNECTION_PHASE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
const SCOPE_READ = 'read:jira-work';
const PROJECT_PAGE_SIZE = 50;
const SCOPE_WRITE = 'write:jira-work';
const SCOPE_MANAGE_WEBHOOK = 'manage:jira-webhook';

type HttpMethod = 'GET' | 'POST' | 'PUT';
type RefreshReason = 'proactive' | 'unauthorized';

interface RequestSpec {
  readonly method: HttpMethod;
  readonly path: string;
  readonly scope: string;
  readonly body?: unknown;
  readonly idempotent: boolean;
}

interface SearchIssuesResponse {
  readonly issues?: JiraIssue[];
  readonly nextPageToken?: string;
  readonly isLast?: boolean;
}

interface ProjectSearchResponse {
  readonly values?: readonly JiraProject[];
  readonly isLast?: boolean;
}

/** One entry per issue type, each with the statuses its workflow uses. */
type ProjectStatusesResponse = ReadonlyArray<{ readonly statuses?: readonly JiraStatus[] }>;

interface ListTransitionsResponse {
  readonly transitions?: JiraTransition[];
}

interface GetCommentsResponse {
  readonly comments?: JiraComment[];
  readonly startAt?: number;
  readonly maxResults?: number;
  readonly total?: number;
}

interface ListWebhooksResponse {
  readonly values?: ListWebhooksResult['values'];
  readonly startAt?: number;
  readonly maxResults?: number;
  readonly total?: number;
  readonly isLast?: boolean;
}

@Injectable()
export class JiraGatewayHttpClient implements JiraGateway {
  private readonly logger = new Logger(JiraGatewayHttpClient.name);
  private readonly refreshInFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly config: ConfigService,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(ATLASSIAN_OAUTH) private readonly atlassian: AtlassianOAuth,
    @Inject(JIRA_GATEWAY_OPTIONS) private readonly options: JiraGatewayOptions = {},
  ) {}

  async listProjects(input: ListProjectsInput): Promise<JiraProject[]> {
    const projects: JiraProject[] = [];
    for (;;) {
      const page = await this.requestJson<ProjectSearchResponse | undefined>(input.boardId, {
        method: 'GET',
        path: `/project/search?startAt=${projects.length}&maxResults=${PROJECT_PAGE_SIZE}`,
        scope: SCOPE_READ,
        idempotent: true,
      });
      const values = page?.values ?? [];
      projects.push(...values.map(({ id, key, name }) => ({ id, key, name })));
      // An empty page also stops, so a server that never sets isLast cannot loop forever.
      if (page?.isLast !== false || values.length === 0) {
        return projects;
      }
    }
  }

  async listProjectStatuses(input: ListProjectStatusesInput): Promise<JiraStatus[]> {
    const issueTypes = await this.requestJson<ProjectStatusesResponse>(input.boardId, {
      method: 'GET',
      path: `/project/${encodeURIComponent(input.projectKey)}/statuses`,
      scope: SCOPE_READ,
      idempotent: true,
    });
    const byId = new Map<string, JiraStatus>();
    for (const issueType of issueTypes ?? []) {
      for (const status of issueType.statuses ?? []) {
        if (!byId.has(status.id)) byId.set(status.id, status);
      }
    }
    return [...byId.values()];
  }

  async searchIssues(input: SearchIssuesInput): Promise<SearchIssuesResult> {
    const fields = [...new Set([...DEFAULT_SEARCH_FIELDS, ...(input.fields ?? [])])];
    const query = new URLSearchParams();
    query.set('jql', input.jql);
    query.set('fields', fields.join(','));
    if (input.maxResults !== undefined) {
      query.set('maxResults', String(input.maxResults));
    }
    if (input.nextPageToken !== undefined) {
      query.set('nextPageToken', input.nextPageToken);
    }
    if (input.expand && input.expand.length > 0) {
      query.set('expand', input.expand.join(','));
    }

    const result = await this.requestJson<SearchIssuesResponse>(input.boardId, {
      method: 'GET',
      path: `/search/jql?${query.toString()}`,
      scope: SCOPE_READ,
      idempotent: true,
    });
    return {
      issues: result.issues ?? [],
      nextPageToken: result.nextPageToken ?? null,
      isLast: result.isLast ?? false,
    };
  }

  async listTransitions(input: ListTransitionsInput): Promise<ListTransitionsResult> {
    const query = new URLSearchParams();
    if (input.expand !== undefined) {
      query.set('expand', input.expand);
    }
    if (input.transitionId !== undefined) {
      query.set('transitionId', input.transitionId);
    }
    if (input.includeUnavailableTransitions !== undefined) {
      query.set('includeUnavailableTransitions', String(input.includeUnavailableTransitions));
    }
    const suffix = query.toString();

    const result = await this.requestJson<ListTransitionsResponse>(input.boardId, {
      method: 'GET',
      path: `${this.issuePath(input.issueIdOrKey)}/transitions${suffix ? `?${suffix}` : ''}`,
      scope: SCOPE_READ,
      idempotent: true,
    });
    return { transitions: result.transitions ?? [] };
  }

  async doTransition(input: DoTransitionInput): Promise<void> {
    const body: Record<string, unknown> = { transition: { id: input.transitionId } };
    if (input.fields !== undefined) {
      body['fields'] = input.fields;
    }
    if (input.update !== undefined) {
      body['update'] = input.update;
    }

    await this.requestNoContent(input.boardId, {
      method: 'POST',
      path: `${this.issuePath(input.issueIdOrKey)}/transitions`,
      scope: SCOPE_WRITE,
      body,
      idempotent: false,
    });
  }

  async getComments(input: GetCommentsInput): Promise<GetCommentsResult> {
    const query = new URLSearchParams();
    if (input.startAt !== undefined) {
      query.set('startAt', String(input.startAt));
    }
    if (input.maxResults !== undefined) {
      query.set('maxResults', String(input.maxResults));
    }
    if (input.orderBy !== undefined) {
      query.set('orderBy', input.orderBy);
    }
    if (input.expand !== undefined) {
      query.set('expand', input.expand);
    }
    const suffix = query.toString();

    const result = await this.requestJson<GetCommentsResponse>(input.boardId, {
      method: 'GET',
      path: `${this.issuePath(input.issueIdOrKey)}/comment${suffix ? `?${suffix}` : ''}`,
      scope: SCOPE_READ,
      idempotent: true,
    });
    return {
      comments: result.comments ?? [],
      startAt: result.startAt ?? 0,
      maxResults: result.maxResults ?? 0,
      total: result.total ?? 0,
    };
  }

  async addComment(input: AddCommentInput): Promise<AddCommentResult> {
    return this.requestJson<AddCommentResult>(input.boardId, {
      method: 'POST',
      path: `${this.issuePath(input.issueIdOrKey)}/comment`,
      scope: SCOPE_WRITE,
      body: { body: input.body },
      idempotent: false,
    });
  }

  async registerWebhook(input: RegisterWebhookInput): Promise<RegisterWebhookResult> {
    return this.requestJson<RegisterWebhookResult>(input.boardId, {
      method: 'POST',
      path: '/webhook',
      scope: SCOPE_MANAGE_WEBHOOK,
      body: { url: input.url, webhooks: input.webhooks },
      idempotent: false,
    });
  }

  async listWebhooks(input: ListWebhooksInput): Promise<ListWebhooksResult> {
    const query = new URLSearchParams();
    if (input.startAt !== undefined) {
      query.set('startAt', String(input.startAt));
    }
    if (input.maxResults !== undefined) {
      query.set('maxResults', String(input.maxResults));
    }
    const suffix = query.toString();

    const result = await this.requestJson<ListWebhooksResponse>(input.boardId, {
      method: 'GET',
      path: `/webhook${suffix ? `?${suffix}` : ''}`,
      scope: SCOPE_MANAGE_WEBHOOK,
      idempotent: true,
    });
    return {
      values: result.values ?? [],
      startAt: result.startAt ?? 0,
      maxResults: result.maxResults ?? 0,
      total: result.total ?? 0,
      isLast: result.isLast ?? false,
    };
  }

  async refreshWebhooks(input: RefreshWebhooksInput): Promise<RefreshWebhooksResult> {
    return this.requestJson<RefreshWebhooksResult>(input.boardId, {
      method: 'PUT',
      path: '/webhook/refresh',
      scope: SCOPE_MANAGE_WEBHOOK,
      body: { webhookIds: input.webhookIds },
      idempotent: true,
    });
  }

  private async requestJson<T>(boardId: string, spec: RequestSpec): Promise<T> {
    const deadline = this.now() + this.timeBudgetMs;
    this.assertBudget(deadline, 0);
    const access = await this.ensureFreshAccessToken(boardId, spec.scope);
    const response = await this.execute(
      boardId,
      access.cloudId,
      access.accessToken,
      spec,
      deadline,
    );
    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new JiraClientError(response.status, 'invalid_json');
    }
  }

  private async requestNoContent(boardId: string, spec: RequestSpec): Promise<void> {
    const deadline = this.now() + this.timeBudgetMs;
    this.assertBudget(deadline, 0);
    const access = await this.ensureFreshAccessToken(boardId, spec.scope);
    const response = await this.execute(
      boardId,
      access.cloudId,
      access.accessToken,
      spec,
      deadline,
    );
    if (response.status !== 204) {
      await this.drain(response);
      throw new JiraClientError(response.status, 'unexpected_status');
    }
  }

  private async execute(
    boardId: string,
    cloudId: string,
    initialAccessToken: string,
    spec: RequestSpec,
    deadline: number,
  ): Promise<Response> {
    let accessToken = initialAccessToken;
    let authRetried = false;
    let rateLimitRetried = false;
    let serverAttempts = 0;
    let timeoutAttempts = 0;
    let networkAttempts = 0;
    let attempts = 0;
    const url = `${this.apiBase(cloudId)}${spec.path}`;

    for (;;) {
      this.assertBudget(deadline, attempts);
      attempts += 1;
      const remaining = deadline - this.now();
      const timeout = Math.min(this.timeoutMs, remaining);
      if (timeout <= 0) {
        throw new JiraTimeBudgetExceededError(this.timeBudgetMs, attempts - 1);
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      };
      const init: RequestInit = {
        method: spec.method,
        headers,
        signal: AbortSignal.timeout(timeout),
      };
      if (spec.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(spec.body);
      }

      try {
        const response = await fetch(url, init);

        if (response.ok) {
          return response;
        }
        if (response.status === 401) {
          await this.drain(response);
          if (authRetried) {
            throw new JiraUnauthorizedError('access token rejected after refresh');
          }
          const stored = await this.readStoredAccessToken(boardId);
          accessToken =
            stored === accessToken
              ? await this.refreshOnce(boardId, accessToken, 'unauthorized')
              : stored;
          authRetried = true;
          continue;
        }
        if (response.status === 429) {
          const retryAfter = this.parseRetryAfter(response.headers.get('retry-after'));
          await this.drain(response);
          if (rateLimitRetried || retryAfter === null || retryAfter > MAX_RETRY_AFTER_SECONDS) {
            throw new JiraRateLimitedError(retryAfter);
          }
          await this.wait(retryAfter * 1000, deadline, attempts);
          rateLimitRetried = true;
          continue;
        }
        if (response.status >= 500) {
          await this.drain(response);
          if (!spec.idempotent) {
            throw new JiraServerError(response.status, 1, 1);
          }
          serverAttempts += 1;
          if (serverAttempts >= 3) {
            throw new JiraServerError(response.status, serverAttempts, 3);
          }
          const delay = Math.min(1000 * 2 ** (serverAttempts - 1) * this.jitter(), 10_000);
          await this.wait(delay, deadline, attempts);
          continue;
        }
        throw await this.toClientError(response);
      } catch (error) {
        if (error instanceof JiraGatewayError) {
          throw error;
        }
        if (isAbortError(error)) {
          if (!spec.idempotent) {
            throw new JiraTimeoutError(1, 1);
          }
          timeoutAttempts += 1;
          if (timeoutAttempts >= 2) {
            throw new JiraTimeoutError(timeoutAttempts, 2);
          }
          continue;
        }
        const code = networkCode(error);
        if (code !== null) {
          const connectionPhase = CONNECTION_PHASE_CODES.has(code);
          if (!spec.idempotent) {
            if (connectionPhase && networkAttempts === 0) {
              networkAttempts = 1;
              continue;
            }
            const made = networkAttempts + 1;
            throw new JiraServerError(503, made, connectionPhase ? 2 : 1);
          }
          networkAttempts += 1;
          if (networkAttempts >= 3) {
            throw new JiraServerError(503, networkAttempts, 3);
          }
          continue;
        }
        throw error;
      }
    }
  }

  private async ensureFreshAccessToken(
    boardId: string,
    requiredScope: string,
  ): Promise<{ accessToken: string; cloudId: string }> {
    const connection = await this.loadConnection(boardId);
    if (connection === null) {
      throw new JiraUnauthorizedError('connection not found');
    }
    this.assertScope(connection, requiredScope);
    const accessToken = this.cipher.decrypt(connection.accessTokenEnc);
    const remaining = connection.expiresAt.getTime() - this.now();

    if (remaining > REFRESH_WINDOW_MS) {
      return { accessToken, cloudId: connection.cloudId };
    }
    if (connection.refreshTokenEnc === null) {
      if (remaining <= 0) {
        throw new JiraUnauthorizedError('reconnect required');
      }
      return { accessToken, cloudId: connection.cloudId };
    }
    const refreshed = await this.refreshOnce(boardId, accessToken, 'proactive');
    return { accessToken: refreshed, cloudId: connection.cloudId };
  }

  private refreshOnce(
    boardId: string,
    usedAccessToken: string,
    reason: RefreshReason,
  ): Promise<string> {
    const existing = this.refreshInFlight.get(boardId);
    if (existing !== undefined) {
      return existing;
    }
    const promise = this.doRefresh(boardId, usedAccessToken, reason).finally(() => {
      this.refreshInFlight.delete(boardId);
    });
    this.refreshInFlight.set(boardId, promise);
    return promise;
  }

  private async doRefresh(
    boardId: string,
    usedAccessToken: string,
    reason: RefreshReason,
  ): Promise<string> {
    const connection = await this.loadConnection(boardId);
    if (connection === null) {
      throw new JiraUnauthorizedError('connection not found');
    }
    const storedAccessToken = this.cipher.decrypt(connection.accessTokenEnc);
    if (storedAccessToken !== usedAccessToken) {
      return storedAccessToken;
    }
    if (reason === 'proactive' && connection.expiresAt.getTime() - this.now() > REFRESH_WINDOW_MS) {
      return storedAccessToken;
    }
    if (connection.refreshTokenEnc === null) {
      throw new JiraUnauthorizedError('reconnect required');
    }

    const previousRefreshTokenEnc = connection.refreshTokenEnc;
    let tokens: AtlassianTokens;
    try {
      tokens = await this.atlassian.refreshAccessToken(
        this.cipher.decrypt(previousRefreshTokenEnc),
      );
    } catch (error) {
      throw await this.refreshFailure(error, boardId, previousRefreshTokenEnc);
    }

    return this.persistTokens(boardId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      previousRefreshTokenEnc,
      expiresAt: new Date(this.now() + tokens.expiresIn * 1000),
    });
  }

  private async refreshFailure(
    error: unknown,
    boardId: string,
    previousRefreshTokenEnc: string,
  ): Promise<Error> {
    if (error instanceof AtlassianRejectedError) {
      if (error.providerError === 'invalid_grant') {
        await this.clearRefreshToken(boardId, previousRefreshTokenEnc);
        return new JiraUnauthorizedError('reconnect required');
      }
      return new JiraUnauthorizedError(error.providerError);
    }
    if (error instanceof AtlassianUnavailableError) {
      const status = /HTTP (\d{3})/.exec(error.message);
      if (status !== null) {
        return new JiraServerError(Number(status[1]), 1, 1);
      }
      if (/timeout|abort/i.test(error.message)) {
        return new JiraTimeoutError(1, 1);
      }
      return new JiraServerError(503, 1, 1);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private async clearRefreshToken(boardId: string, previousRefreshTokenEnc: string): Promise<void> {
    try {
      const result = await this.connections.update(
        { boardId, refreshTokenEnc: previousRefreshTokenEnc },
        { refreshTokenEnc: null },
      );
      this.logger.warn(
        `Jira refresh token cleared after invalid_grant (affected=${result.affected ?? 0})`,
      );
    } catch {
      this.logger.error('Failed to clear Jira refresh token after invalid_grant');
    }
  }

  private async persistTokens(
    boardId: string,
    values: {
      accessToken: string;
      refreshToken: string | null;
      previousRefreshTokenEnc: string;
      expiresAt: Date;
    },
  ): Promise<string> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const accessTokenEnc = this.cipher.encrypt(values.accessToken);
        const refreshTokenEnc =
          values.refreshToken === null
            ? values.previousRefreshTokenEnc
            : this.cipher.encrypt(values.refreshToken);
        const result = await this.connections.update(
          { boardId, refreshTokenEnc: values.previousRefreshTokenEnc },
          { accessTokenEnc, refreshTokenEnc, expiresAt: values.expiresAt },
        );
        if ((result?.affected ?? 0) > 0) {
          return values.accessToken;
        }
      } catch {
        this.logger.error(`Failed to persist refreshed Jira tokens (attempt ${attempt}/2)`);
        continue;
      }
      this.logger.warn(
        'Refreshed Jira tokens were not persisted because the connection changed; using stored credentials',
      );
      return this.readStoredAccessToken(boardId);
    }
    throw new JiraPersistenceError(2, 2);
  }

  private async loadConnection(boardId: string): Promise<JiraConnectionEntity | null> {
    return this.connections.findOne({
      where: { boardId },
      select: {
        boardId: true,
        cloudId: true,
        accessTokenEnc: true,
        refreshTokenEnc: true,
        expiresAt: true,
        scopes: true,
      },
    });
  }

  private assertScope(connection: JiraConnectionEntity, requiredScope: string): void {
    const scopes = connection.scopes;
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return;
    }
    if (!scopes.includes(requiredScope)) {
      throw new JiraClientError(403, 'missing_scope');
    }
  }

  private async readStoredAccessToken(boardId: string): Promise<string> {
    const connection = await this.loadConnection(boardId);
    if (connection === null) {
      throw new JiraUnauthorizedError('connection not found');
    }
    return this.cipher.decrypt(connection.accessTokenEnc);
  }

  private async toClientError(response: Response): Promise<JiraClientError> {
    const json = await this.readJsonObject(response);
    const errorMessages = Array.isArray(json['errorMessages'])
      ? (json['errorMessages'] as unknown[]).map((message) => String(message))
      : [];
    const fieldErrors: Record<string, string> = {};
    const rawErrors = json['errors'];
    if (typeof rawErrors === 'object' && rawErrors !== null && !Array.isArray(rawErrors)) {
      for (const [field, message] of Object.entries(rawErrors as Record<string, unknown>)) {
        fieldErrors[field] = String(message);
      }
    }
    const providerError =
      typeof json['error'] === 'string'
        ? json['error']
        : (errorMessages[0] ?? `HTTP ${response.status}`);
    return new JiraClientError(response.status, providerError, errorMessages, fieldErrors);
  }

  private async readJsonObject(response: Response): Promise<Record<string, unknown>> {
    try {
      const value: unknown = await response.json();
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private async drain(response: Response): Promise<void> {
    await response.text().catch(() => undefined);
  }

  private parseRetryAfter(value: string | null): number | null {
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
    const timestamp = Date.parse(trimmed);
    if (Number.isNaN(timestamp)) {
      return null;
    }
    return Math.max(0, Math.ceil((timestamp - this.now()) / 1000));
  }

  private assertBudget(deadline: number, attempts: number): void {
    if (this.now() >= deadline) {
      throw new JiraTimeBudgetExceededError(this.timeBudgetMs, attempts);
    }
  }

  private async wait(ms: number, deadline: number, attempts: number): Promise<void> {
    if (this.now() + ms > deadline) {
      throw new JiraTimeBudgetExceededError(this.timeBudgetMs, attempts);
    }
    await this.sleep(ms);
  }

  private issuePath(issueIdOrKey: string): string {
    return `/issue/${encodeURIComponent(issueIdOrKey)}`;
  }

  private apiBase(cloudId: string): string {
    const base = this.config.getOrThrow<string>('jira.apiBaseUrl').replace(/\/+$/, '');
    return `${base}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3`;
  }

  private jitter(): number {
    return 0.75 + this.random() * 0.5;
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? JIRA_GATEWAY_TIMEOUT_MS;
  }

  private get timeBudgetMs(): number {
    return this.options.timeBudgetMs ?? JIRA_GATEWAY_TIME_BUDGET_MS;
  }

  private get now(): () => number {
    return this.options.now ?? (() => Date.now());
  }

  private get sleep(): (ms: number) => Promise<void> {
    return this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private get random(): () => number {
    return this.options.random ?? (() => Math.random());
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function networkCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as { code?: unknown }).code === 'string'
  ) {
    return (cause as { code: string }).code;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
