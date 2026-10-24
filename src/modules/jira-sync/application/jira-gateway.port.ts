/** Injection token for the Jira REST API v3 gateway. */
export const JIRA_GATEWAY = Symbol('JIRA_GATEWAY');

/** Fields always requested by `searchIssues`, because `/search/jql` returns only ids by default. */
export const DEFAULT_SEARCH_FIELDS = [
  'summary',
  'status',
  'assignee',
  'reporter',
  'created',
  'updated',
] as const;

/** Typed operations against the Jira Cloud REST API v3 for one board connection. */
export interface JiraGateway {
  /** Lists every status used by the project's issue types, once each. */
  listProjectStatuses(input: ListProjectStatusesInput): Promise<JiraStatus[]>;
  /** Searches issues with JQL. Caller fields are merged with `DEFAULT_SEARCH_FIELDS`. */
  searchIssues(input: SearchIssuesInput): Promise<SearchIssuesResult>;
  /** Lists the transitions available for an issue. */
  listTransitions(input: ListTransitionsInput): Promise<ListTransitionsResult>;
  /** Executes a transition. Resolves when Jira returns 204. */
  doTransition(input: DoTransitionInput): Promise<void>;
  /** Reads a page of issue comments. */
  getComments(input: GetCommentsInput): Promise<GetCommentsResult>;
  /** Adds an ADF comment to an issue. */
  addComment(input: AddCommentInput): Promise<AddCommentResult>;
  /** Registers one or more dynamic webhooks. */
  registerWebhook(input: RegisterWebhookInput): Promise<RegisterWebhookResult>;
  /** Lists registered dynamic webhooks. */
  listWebhooks(input: ListWebhooksInput): Promise<ListWebhooksResult>;
  /** Extends the expiration of registered dynamic webhooks. */
  refreshWebhooks(input: RefreshWebhooksInput): Promise<RefreshWebhooksResult>;
}

/** Input for listing the statuses of a project. */
export interface ListProjectStatusesInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Jira project key, e.g. `KAN`. */
  readonly projectKey: string;
}

/** Input for a JQL search. */
export interface SearchIssuesInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Jira Query Language expression. */
  readonly jql: string;
  /** Cursor returned by the previous page. */
  readonly nextPageToken?: string;
  /** Maximum number of issues to return. */
  readonly maxResults?: number;
  /** Extra fields to request; merged with, never replacing, the defaults. */
  readonly fields?: readonly string[];
  /** Optional Jira response expansions. */
  readonly expand?: readonly string[];
}

/** One page of JQL search results. */
export interface SearchIssuesResult {
  /** Issues in this page. */
  readonly issues: readonly JiraIssue[];
  /** Cursor for the next page, or `null` when there is none. */
  readonly nextPageToken: string | null;
  /** Jira's explicit end-of-results marker. */
  readonly isLast: boolean;
}

/** A Jira issue and the fields requested from the search endpoint. */
export interface JiraIssue {
  /** Numeric issue id as a string. */
  readonly id: string;
  /** Human-readable issue key, e.g. `KAN-1`. */
  readonly key: string;
  /** Canonical API URL of the issue. */
  readonly self: string;
  /** Requested issue fields. */
  readonly fields: JiraIssueFields;
}

/** Subset of issue fields requested by the gateway defaults. */
export interface JiraIssueFields {
  /** Issue summary. */
  readonly summary: string;
  /** Current workflow status. */
  readonly status: JiraStatus;
  /** Current assignee, or `null` when unassigned. */
  readonly assignee: JiraUser | null;
  /** Issue reporter, or `null` when hidden/unavailable. */
  readonly reporter: JiraUser | null;
  /** Creation timestamp. */
  readonly created: string;
  /** Last update timestamp. */
  readonly updated: string;
}

/** A Jira workflow status. */
export interface JiraStatus {
  /** Status id. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Optional description. */
  readonly description?: string;
  /** Optional status icon URL. */
  readonly iconUrl?: string;
  /** Optional API URL. */
  readonly self?: string;
  /** Status category used for board mapping. */
  readonly statusCategory: JiraStatusCategory;
}

/** Jira status category (To Do, In Progress, Done). */
export interface JiraStatusCategory {
  /** Numeric category id. */
  readonly id: number;
  /** Stable category key, e.g. `new`. */
  readonly key: string;
  /** Display name. */
  readonly name: string;
  /** Optional colour name. */
  readonly colorName?: string;
  /** Optional API URL. */
  readonly self?: string;
}

/** A Jira user reference. */
export interface JiraUser {
  /** Atlassian account id. */
  readonly accountId: string;
  /** Display name. */
  readonly displayName: string;
  /** Whether the account is active. */
  readonly active: boolean;
  /** Optional email address, subject to Jira privacy settings. */
  readonly emailAddress?: string;
  /** Optional account type, e.g. `atlassian`. */
  readonly accountType?: string;
  /** Optional user time zone. */
  readonly timeZone?: string;
}

/** Atlassian Document Format comment body. */
export interface JiraCommentBody {
  /** ADF document node type. */
  readonly type: 'doc';
  /** ADF version. */
  readonly version: number;
  /** Top-level ADF nodes. */
  readonly content: readonly unknown[];
}

/** A Jira issue comment. */
export interface JiraComment {
  /** Comment id. */
  readonly id: string;
  /** Optional API URL. */
  readonly self?: string;
  /** Comment author. */
  readonly author: JiraUser;
  /** Author of the last update, when present. */
  readonly updateAuthor?: JiraUser;
  /** ADF body. */
  readonly body: JiraCommentBody;
  /** Creation timestamp. */
  readonly created: string;
  /** Last update timestamp. */
  readonly updated: string;
}

/** Input for listing available transitions. */
export interface ListTransitionsInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Issue key or numeric id. */
  readonly issueIdOrKey: string;
  /** Optional Jira expansion, e.g. `transitions.fields`. */
  readonly expand?: string;
  /** Restrict the result to one transition id. */
  readonly transitionId?: string;
  /** Include transitions the user cannot currently execute. */
  readonly includeUnavailableTransitions?: boolean;
}

/** Available transitions for one issue. */
export interface ListTransitionsResult {
  /** Transitions; empty when none are available. */
  readonly transitions: readonly JiraTransition[];
}

/** One available workflow transition. */
export interface JiraTransition {
  /** Transition id used by `doTransition`. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Destination status. */
  readonly to: JiraStatus;
  /** Whether executing the transition requires a screen. */
  readonly hasScreen: boolean;
  /** Whether the transition is global. */
  readonly isGlobal: boolean;
  /** Whether this is an initial transition. */
  readonly isInitial: boolean;
  /** Whether the transition is conditional. */
  readonly isConditional: boolean;
  /** Whether the current user can execute it. */
  readonly isAvailable: boolean;
  /** Required fields, present only with the corresponding expansion. */
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** Input for executing a workflow transition. */
export interface DoTransitionInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Issue key or numeric id. */
  readonly issueIdOrKey: string;
  /** Transition id to execute. */
  readonly transitionId: string;
  /** Optional field values for a transition screen. */
  readonly fields?: Readonly<Record<string, unknown>>;
  /** Optional field update operations. */
  readonly update?: Readonly<Record<string, readonly unknown[]>>;
}

/** Input for reading issue comments. */
export interface GetCommentsInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Issue key or numeric id. */
  readonly issueIdOrKey: string;
  /** Zero-based index of the first comment. */
  readonly startAt?: number;
  /** Maximum number of comments to return. */
  readonly maxResults?: number;
  /** Optional Jira ordering expression. */
  readonly orderBy?: string;
  /** Optional Jira response expansion. */
  readonly expand?: string;
}

/** One page of issue comments. */
export interface GetCommentsResult {
  /** Comments in this page. */
  readonly comments: readonly JiraComment[];
  /** Index of the first returned comment. */
  readonly startAt: number;
  /** Requested page size. */
  readonly maxResults: number;
  /** Total number of comments on the issue. */
  readonly total: number;
}

/** Input for adding a comment. */
export interface AddCommentInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Issue key or numeric id. */
  readonly issueIdOrKey: string;
  /** ADF comment body. */
  readonly body: JiraCommentBody;
}

/** The created comment. */
export interface AddCommentResult {
  /** Comment id. */
  readonly id: string;
  /** API URL of the comment. */
  readonly self: string;
  /** Comment author. */
  readonly author: JiraUser;
  /** Author of the last update, when present. */
  readonly updateAuthor?: JiraUser;
  /** Stored ADF body. */
  readonly body: JiraCommentBody;
  /** Creation timestamp. */
  readonly created: string;
  /** Last update timestamp. */
  readonly updated: string;
}

/** Input for registering dynamic webhooks. */
export interface RegisterWebhookInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Public webhook receiver URL. */
  readonly url: string;
  /** Webhook definitions to register. */
  readonly webhooks: readonly RegisterWebhookEntry[];
}

/** One dynamic webhook definition. */
export interface RegisterWebhookEntry {
  /** Jira event names to subscribe to. */
  readonly events: readonly string[];
  /** Required JQL filter limiting delivered events. */
  readonly jqlFilter: string;
}

/** Per-webhook registration result. */
export type WebhookRegistrationOutcome =
  { readonly createdWebhookId: number } | { readonly errors: readonly string[] };

/** Jira's per-entry webhook registration response. */
export interface RegisterWebhookResult {
  /** Outcomes in the same order as the requested webhooks. */
  readonly webhookRegistrationResult: readonly WebhookRegistrationOutcome[];
}

/** Input for listing dynamic webhooks. */
export interface ListWebhooksInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Zero-based index of the first webhook. */
  readonly startAt?: number;
  /** Maximum number of webhooks to return. */
  readonly maxResults?: number;
}

/** A registered dynamic webhook. */
export interface JiraWebhook {
  /** Webhook id. */
  readonly id: number;
  /** Receiver URL. */
  readonly url: string;
  /** JQL delivery filter. */
  readonly jqlFilter: string;
  /** Subscribed Jira events. */
  readonly events: readonly string[];
  /** Expiration timestamp. */
  readonly expirationDate: string;
  /** Optional field filter. */
  readonly fieldIdsFilter?: readonly string[];
  /** Optional issue-property filter. */
  readonly issuePropertyKeysFilter?: readonly string[];
}

/** One page of dynamic webhooks. */
export interface ListWebhooksResult {
  /** Webhooks in this page. */
  readonly values: readonly JiraWebhook[];
  /** Index of the first returned webhook. */
  readonly startAt: number;
  /** Requested page size. */
  readonly maxResults: number;
  /** Total number of registered webhooks. */
  readonly total: number;
  /** Jira's explicit end-of-results marker. */
  readonly isLast: boolean;
}

/** Input for refreshing dynamic webhook expiration. */
export interface RefreshWebhooksInput {
  /** Board whose Jira connection supplies the cloud id and token. */
  readonly boardId: string;
  /** Webhook ids to refresh. */
  readonly webhookIds: readonly number[];
}

/** New expiration returned after a webhook refresh. */
export interface RefreshWebhooksResult {
  /** New expiration timestamp. */
  readonly expirationDate: string;
}
