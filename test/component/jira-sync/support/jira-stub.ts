import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { URL, URLSearchParams } from 'url';

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
  responseBody: unknown;
  readonly headers: IncomingMessage['headers'];
  readonly receivedAt: number;
}

export interface StubIssue {
  readonly id: string;
  readonly key: string;
  readonly summary: string;
  readonly status: JiraStatus;
  readonly assignee: JiraUser | null;
  readonly reporter: JiraUser | null;
  readonly created: string;
  readonly updated: string;
}

export interface JiraStatus {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly iconUrl?: string;
  readonly self?: string;
  readonly statusCategory: JiraStatusCategory;
}

export interface JiraStatusCategory {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly colorName?: string;
  readonly self?: string;
}

export interface JiraUser {
  readonly accountId: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly emailAddress?: string;
  readonly accountType?: string;
  readonly timeZone?: string;
}

export interface JiraComment {
  readonly id: string;
  readonly self?: string;
  readonly author: JiraUser;
  readonly updateAuthor?: JiraUser;
  readonly body: JiraCommentBody;
  readonly created: string;
  readonly updated: string;
}

export interface JiraCommentBody {
  readonly type: 'doc';
  readonly version: number;
  readonly content: readonly unknown[];
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  readonly to: JiraStatus;
  readonly hasScreen: boolean;
  readonly isGlobal: boolean;
  readonly isInitial: boolean;
  readonly isConditional: boolean;
  readonly isAvailable: boolean;
}

export interface JiraWebhook {
  readonly id: number;
  readonly url: string;
  readonly jqlFilter: string;
  readonly events: readonly string[];
  readonly expirationDate: string;
}

export interface StubProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly statuses: readonly JiraStatus[];
}

export interface StubState {
  issues: Map<string, StubIssue>;
  projects: Map<string, StubProject>;
  transitions: Map<string, readonly JiraTransition[]>;
  comments: Map<string, JiraComment[]>;
  webhooks: Map<number, JiraWebhook>;
  nextWebhookId: number;
  nextCommentId: number;
}

export type StubMode = 'normal' | 'down' | 'status' | 'delay';

interface JiraStubOptions {
  readonly baseUrl: string;
  readonly cloudId: string;
}

export class JiraStub {
  private readonly server: Server;
  private readonly state: StubState;
  private mode: StubMode = 'normal';
  private delayMs = 0;
  private statusCode = 200;
  private readonly calls: RecordedCall[] = [];
  private readonly cloudId: string;
  private readonly basePath: string;

  constructor(options: JiraStubOptions) {
    this.cloudId = options.cloudId;
    this.basePath = `/ex/jira/${encodeURIComponent(this.cloudId)}/rest/api/3`;
    this.state = {
      issues: new Map(),
      projects: new Map(),
      transitions: new Map(),
      comments: new Map(),
      webhooks: new Map(),
      nextWebhookId: 1,
      nextCommentId: 1,
    };
    this.server = createServer((req, res) => void this.handleRequest(req, res));
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  get issues(): ReadonlyMap<string, StubIssue> {
    return this.state.issues;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  reset(): void {
    this.state.issues.clear();
    this.state.projects.clear();
    this.state.transitions.clear();
    this.state.comments.clear();
    this.state.webhooks.clear();
    this.state.nextWebhookId = 1;
    this.state.nextCommentId = 1;
    this.calls.length = 0;
    this.mode = 'normal';
    this.delayMs = 0;
    this.statusCode = 200;
  }

  setMode(mode: StubMode): void {
    this.mode = mode;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  setStatus(code: number): void {
    this.statusCode = code;
  }

  seedIssue(issue: StubIssue): void {
    this.state.issues.set(issue.key, issue);
    this.state.issues.set(issue.id, issue);
  }

  seedProject(project: StubProject): void {
    this.state.projects.set(project.key, project);
    this.state.projects.set(project.id, project);
  }

  seedTransitions(issueKey: string, transitions: readonly JiraTransition[]): void {
    this.state.transitions.set(issueKey, transitions);
    const issue = this.state.issues.get(issueKey);
    if (issue) {
      this.state.transitions.set(issue.id, transitions);
    }
  }

  seedComments(issueKey: string, comments: readonly JiraComment[]): void {
    this.state.comments.set(issueKey, [...comments]);
    const issue = this.state.issues.get(issueKey);
    if (issue) {
      this.state.comments.set(issue.id, [...comments]);
    }
  }

  findCalls(predicate?: (call: RecordedCall) => boolean): readonly RecordedCall[] {
    return predicate ? this.calls.filter(predicate) : [...this.calls];
  }

  lastCall(): RecordedCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  private async handleRequest(req: IncomingMessage, res: StubResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '', `http://localhost`);
    const path = url.pathname;
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    let body: unknown = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    const call: RecordedCall = {
      method: req.method ?? '',
      path,
      query,
      body,
      responseBody: null,
      headers: req.headers,
      receivedAt: Date.now(),
    };
    this.calls.push(call);

    if (this.mode === 'down') {
      res.destroy();
      return;
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    let responseBody: unknown = {};
    let status = this.statusCode;

    try {
      if (path === '/oauth/token' && req.method === 'POST') {
        [status, responseBody] = this.handleToken(body as Record<string, string>);
      } else if (path === '/oauth/token/accessible-resources' && req.method === 'GET') {
        [status, responseBody] = this.handleAccessibleResources(req.headers.authorization);
      } else if (path.startsWith(this.basePath)) {
        const apiPath = path.slice(this.basePath.length);
        [status, responseBody] = this.handleApi(
          apiPath,
          req.method ?? '',
          query,
          body,
          req.headers.authorization,
        );
      } else {
        status = 404;
        responseBody = { error: 'Not found' };
      }
    } catch (error) {
      status = 500;
      responseBody = { error: error instanceof Error ? error.message : 'Internal error' };
    }

    if (this.mode === 'status') {
      status = this.statusCode;
    }

    // Record the response body in the call
    call.responseBody = responseBody;

    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseBody));
  }

  private handleToken(body: Record<string, string>): [number, unknown] {
    const grantType = body['grant_type'];
    const code = body['code'];
    const refreshToken = body['refresh_token'];

    if (grantType === 'authorization_code') {
      switch (code) {
        case 'good-code':
          return [
            200,
            {
              access_token: 'access-from-stub',
              refresh_token: 'refresh-from-stub',
              expires_in: 3600,
              scope: 'read:jira-work write:jira-work manage:jira-webhook offline_access',
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

    if (grantType === 'refresh_token') {
      if (refreshToken === 'refresh-from-stub') {
        return [
          200,
          {
            access_token: 'refreshed-access-token',
            refresh_token: 'refreshed-refresh-token',
            expires_in: 3600,
            scope: 'read:jira-work write:jira-work manage:jira-webhook offline_access',
          },
        ];
      }
      return [403, { error: 'invalid_grant' }];
    }

    return [400, { error: 'unsupported_grant_type' }];
  }

  private handleAccessibleResources(authHeader: string | undefined): [number, unknown] {
    if (authHeader === 'Bearer no-site-token') {
      return [200, []];
    }
    return [
      200,
      [
        {
          id: this.cloudId,
          url: 'https://stub.atlassian.net',
          name: 'Stub Site',
          scopes: ['read:jira-work', 'write:jira-work', 'manage:jira-webhook', 'offline_access'],
        },
      ],
    ];
  }

  private handleApi(
    path: string,
    method: string,
    query: Record<string, string>,
    body: unknown,
    authHeader: string | undefined,
  ): [number, unknown] {
    const url = new URL(path, 'http://localhost');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return [401, { error: 'Unauthorized' }];
    }

    const apiPath = url.pathname;
    const searchParams = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => searchParams.set(k, v));

    if (apiPath === '/project/search' && method === 'GET') {
      return this.handleListProjects(searchParams);
    }
    if (apiPath.startsWith('/project/') && apiPath.endsWith('/statuses') && method === 'GET') {
      const projectKey = decodeURIComponent(apiPath.slice('/project/'.length, -'/statuses'.length));
      return this.handleProjectStatuses(projectKey);
    }
    if (apiPath === '/search/jql' && method === 'GET') {
      return this.handleSearchIssues(searchParams);
    }
    if (apiPath.startsWith('/issue/') && method === 'GET') {
      const issuePath = apiPath.slice('/issue/'.length);
      const issueIdOrKey = issuePath.split('?')[0];
      if (issuePath.includes('/transitions')) {
        const key = issuePath.slice(0, issuePath.indexOf('/transitions'));
        return this.handleListTransitions(decodeURIComponent(key), searchParams);
      }
      if (issuePath.includes('/comment') && method === 'GET') {
        const key = issuePath.slice(0, issuePath.indexOf('/comment'));
        return this.handleGetComments(decodeURIComponent(key), searchParams);
      }
      return this.handleGetIssue(decodeURIComponent(issueIdOrKey));
    }
    if (apiPath.startsWith('/issue/') && method === 'POST' && apiPath.endsWith('/comment')) {
      const issueIdOrKey = decodeURIComponent(apiPath.slice('/issue/'.length, -'/comment'.length));
      return this.handleAddComment(issueIdOrKey, body);
    }
    if (apiPath.startsWith('/issue/') && method === 'POST' && apiPath.endsWith('/transitions')) {
      const issueIdOrKey = decodeURIComponent(
        apiPath.slice('/issue/'.length, -'/transitions'.length),
      );
      return this.handleDoTransition(issueIdOrKey, body);
    }
    if (apiPath === '/webhook' && method === 'POST') {
      return this.handleRegisterWebhook(body);
    }
    if (apiPath === '/webhook' && method === 'GET') {
      return this.handleListWebhooks(searchParams);
    }
    if (apiPath === '/webhook/refresh' && method === 'PUT') {
      return this.handleRefreshWebhooks(body);
    }

    return [404, { error: 'Not found' }];
  }

  private handleListProjects(searchParams: URLSearchParams): [number, unknown] {
    const startAt = parseInt(searchParams.get('startAt') ?? '0', 10);
    const maxResults = parseInt(searchParams.get('maxResults') ?? '50', 10);
    const projects = Array.from(this.state.projects.values());
    const page = projects.slice(startAt, startAt + maxResults);
    return [
      200,
      {
        values: page.map((p) => ({ id: p.id, key: p.key, name: p.name })),
        isLast: startAt + maxResults >= projects.length,
      },
    ];
  }

  private handleProjectStatuses(projectKey: string): [number, unknown] {
    const project = this.state.projects.get(projectKey);
    if (!project) {
      return [404, { error: 'Project not found' }];
    }
    return [200, [{ statuses: project.statuses }]];
  }

  private handleSearchIssues(searchParams: URLSearchParams): [number, unknown] {
    const jql = searchParams.get('jql') ?? '';
    const nextPageToken = searchParams.get('nextPageToken');
    const maxResults = parseInt(searchParams.get('maxResults') ?? '50', 10);

    // Deduplicate by object reference because seedIssue stores each issue under both key and id
    let allIssues = Array.from(new Set(this.state.issues.values()));
    if (jql.includes('project =')) {
      const projectKeyMatch = jql.match(/project\s*=\s*["']?([^"']+)["']?/);
      if (projectKeyMatch) {
        const projectKey = projectKeyMatch[1];
        allIssues = allIssues.filter((issue) => issue.key.startsWith(`${projectKey}-`));
      }
    }

    let startIdx = 0;
    if (nextPageToken) {
      startIdx = parseInt(nextPageToken, 10);
    }

    const page = allIssues.slice(startIdx, startIdx + maxResults);
    const nextToken =
      startIdx + maxResults < allIssues.length ? String(startIdx + maxResults) : null;

    return [
      200,
      {
        issues: page.map((issue) => ({
          id: issue.id,
          key: issue.key,
          self: `https://stub.atlassian.net/rest/api/3/issue/${issue.id}`,
          fields: {
            summary: issue.summary,
            status: issue.status,
            assignee: issue.assignee,
            reporter: issue.reporter,
            created: issue.created,
            updated: issue.updated,
          },
        })),
        nextPageToken: nextToken,
        isLast: nextToken === null,
      },
    ];
  }

  private handleGetIssue(issueIdOrKey: string): [number, unknown] {
    const issue = this.state.issues.get(issueIdOrKey);
    if (!issue) {
      return [404, { error: 'Issue not found' }];
    }
    return [
      200,
      {
        id: issue.id,
        key: issue.key,
        fields: {
          status: issue.status,
        },
      },
    ];
  }

  private handleListTransitions(
    issueIdOrKey: string,
    searchParams: URLSearchParams,
  ): [number, unknown] {
    const transitions = this.state.transitions.get(issueIdOrKey) ?? [];
    const includeUnavailable = searchParams.get('includeUnavailableTransitions') === 'true';
    const filtered = includeUnavailable ? transitions : transitions.filter((t) => t.isAvailable);
    return [200, { transitions: filtered }];
  }

  private handleDoTransition(issueIdOrKey: string, body: unknown): [number, unknown] {
    const transitionBody = body as {
      transition?: { id: string };
      fields?: Record<string, unknown>;
      update?: Record<string, unknown>;
    };
    const transitionId = transitionBody.transition?.id;
    if (!transitionId) {
      return [400, { error: 'Missing transition id' }];
    }

    const transitions = this.state.transitions.get(issueIdOrKey) ?? [];
    const transition = transitions.find((t) => t.id === transitionId);
    if (!transition) {
      return [404, { error: 'Transition not found' }];
    }
    if (!transition.isAvailable) {
      return [400, { error: 'Transition not available' }];
    }

    const issue = this.state.issues.get(issueIdOrKey);
    if (issue) {
      this.state.issues.set(issueIdOrKey, { ...issue, status: transition.to });
    }
    return [204, undefined];
  }

  private handleGetComments(
    issueIdOrKey: string,
    searchParams: URLSearchParams,
  ): [number, unknown] {
    const startAt = parseInt(searchParams.get('startAt') ?? '0', 10);
    const maxResults = parseInt(searchParams.get('maxResults') ?? '50', 10);
    const comments = this.state.comments.get(issueIdOrKey) ?? [];
    const page = comments.slice(startAt, startAt + maxResults);
    return [
      200,
      {
        comments: page,
        startAt,
        maxResults,
        total: comments.length,
      },
    ];
  }

  private handleAddComment(issueIdOrKey: string, body: unknown): [number, unknown] {
    const commentBody = body as { body?: JiraCommentBody };
    if (!commentBody.body) {
      return [400, { error: 'Missing comment body' }];
    }
    const comments = this.state.comments.get(issueIdOrKey) ?? [];
    const now = new Date().toISOString();
    const newComment: JiraComment = {
      id: String(this.state.nextCommentId++),
      self: `https://stub.atlassian.net/rest/api/3/issue/${issueIdOrKey}/comment/${this.state.nextCommentId}`,
      author: { accountId: 'stub-user', displayName: 'Stub User', active: true },
      body: commentBody.body,
      created: now,
      updated: now,
    };
    this.state.comments.set(issueIdOrKey, [...comments, newComment]);
    return [201, newComment];
  }

  private handleRegisterWebhook(body: unknown): [number, unknown] {
    const webhookBody = body as {
      url: string;
      webhooks: Array<{ events: string[]; jqlFilter: string }>;
    };
    const results = webhookBody.webhooks.map(() => {
      const id = this.state.nextWebhookId++;
      const webhook: JiraWebhook = {
        id,
        url: webhookBody.url,
        jqlFilter: webhookBody.webhooks[0]?.jqlFilter ?? '',
        events: webhookBody.webhooks[0]?.events ?? ['jira:issue_updated'],
        expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
      this.state.webhooks.set(id, webhook);
      return { createdWebhookId: id };
    });
    return [200, { webhookRegistrationResult: results }];
  }

  private handleListWebhooks(searchParams: URLSearchParams): [number, unknown] {
    const startAt = parseInt(searchParams.get('startAt') ?? '0', 10);
    const maxResults = parseInt(searchParams.get('maxResults') ?? '50', 10);
    const webhooks = Array.from(this.state.webhooks.values());
    const page = webhooks.slice(startAt, startAt + maxResults);
    return [
      200,
      {
        values: page,
        startAt,
        maxResults,
        total: webhooks.length,
        isLast: startAt + maxResults >= webhooks.length,
      },
    ];
  }

  private handleRefreshWebhooks(body: unknown): [number, unknown] {
    const refreshBody = body as { webhookIds: number[] };
    for (const id of refreshBody.webhookIds) {
      const webhook = this.state.webhooks.get(id);
      if (webhook) {
        const newExpiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        this.state.webhooks.set(id, { ...webhook, expirationDate: newExpiration });
      }
    }
    return [200, { expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }];
  }
}

type StubResponse = {
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
  destroy: () => void;
};
