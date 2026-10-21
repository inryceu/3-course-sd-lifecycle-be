/** Port for the Atlassian OAuth 2.0 (3LO) endpoints and Jira REST API operations. */
export const ATLASSIAN_OAUTH = Symbol('ATLASSIAN_OAUTH');

export interface AtlassianTokens {
  accessToken: string;
  /** Absent when the app was not granted `offline_access`. */
  refreshToken: string | null;
  /** Lifetime of the access token in seconds. */
  expiresIn: number;
  scopes: string[];
}

export interface AccessibleResource {
  /** Jira cloud id. */
  id: string;
  /** Site URL, e.g. https://example.atlassian.net */
  url: string;
  name: string;
  scopes: string[];
}

export interface JiraIssueFields {
  summary: string;
  description?: string;
  project: { key: string };
  issuetype: { name: string };
  [key: string]: unknown;
}

export interface JiraIssueResponse {
  id: string;
  key: string;
  self: string;
}

export interface JiraTransitionResponse {
  transitions: Array<{ id: string; name: string; to: { statusCategory: { key: string } } }>;
}

export interface AtlassianOAuth {
  /** Throws `AtlassianRejectedError` (4xx) or `AtlassianUnavailableError` (network, 5xx). */
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<AtlassianTokens>;
  listAccessibleResources(accessToken: string): Promise<AccessibleResource[]>;

  /** Creates a Jira issue. */
  createIssue(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    fields: JiraIssueFields;
  }): Promise<JiraIssueResponse>;
  /** Updates a Jira issue. */
  updateIssue(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
    fields: Partial<JiraIssueFields>;
  }): Promise<void>;
  /** Gets available transitions for a Jira issue. */
  getTransitions(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
  }): Promise<JiraTransitionResponse>;
  /** Transitions a Jira issue to a new status. */
  transitionIssue(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
    transitionId: string;
  }): Promise<void>;
  /** Adds a comment to a Jira issue. */
  addComment(input: {
    accessToken: string;
    cloudId: string;
    siteUrl: string;
    issueKey: string;
    body: string;
  }): Promise<void>;
}
