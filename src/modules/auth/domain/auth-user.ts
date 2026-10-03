/** The authenticated user as seen by handlers and other modules. Never contains secrets. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

/** Claims carried by an access token. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
}

/** E-mail addresses are stored and compared trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
