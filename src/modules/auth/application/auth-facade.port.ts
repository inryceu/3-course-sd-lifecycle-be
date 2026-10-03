import { AuthUser } from '../domain/auth-user';

/**
 * Port other modules use to identify users without importing auth internals.
 * Exported through the module's public API only.
 */
export const AUTH_FACADE = Symbol('AUTH_FACADE');

export interface AuthFacade {
  /** The user with this id, or null when it does not exist. */
  getUserById(id: string): Promise<AuthUser | null>;
  /**
   * Verifies signature and expiry of an access token and that the user still exists.
   * Returns null instead of throwing for any invalid token (used by the WebSocket handshake).
   */
  verifyToken(token: string): Promise<AuthUser | null>;
}
