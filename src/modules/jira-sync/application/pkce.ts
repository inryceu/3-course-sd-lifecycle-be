import { createHash, randomBytes } from 'crypto';

/** Anti-CSRF state: 32 random bytes, hex encoded. */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

/** PKCE code verifier: 32 random bytes, base64url (43 characters, within RFC 7636 limits). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** PKCE S256 code challenge. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
