/** Atlassian rejected the request (invalid or reused code, bad client credentials, ...). */
export class AtlassianRejectedError extends Error {
  constructor(
    readonly providerError: string,
    readonly status: number,
  ) {
    super(`Atlassian rejected the request: ${providerError} (HTTP ${status})`);
    this.name = 'AtlassianRejectedError';
  }
}

/** Atlassian could not be reached or answered with a server error. */
export class AtlassianUnavailableError extends Error {
  constructor(detail: string) {
    super(`Atlassian is unavailable: ${detail}`);
    this.name = 'AtlassianUnavailableError';
  }
}

/** Stored ciphertext was modified, truncated or encrypted with another key. */
export class TokenIntegrityError extends Error {
  constructor() {
    super('Stored token failed the integrity check');
    this.name = 'TokenIntegrityError';
  }
}
