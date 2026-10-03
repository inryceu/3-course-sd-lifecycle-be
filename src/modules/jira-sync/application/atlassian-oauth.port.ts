/** Port for the Atlassian OAuth 2.0 (3LO) endpoints. */
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

export interface AtlassianOAuth {
  /** Throws `AtlassianRejectedError` (4xx) or `AtlassianUnavailableError` (network, 5xx). */
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<AtlassianTokens>;
  listAccessibleResources(accessToken: string): Promise<AccessibleResource[]>;
}
