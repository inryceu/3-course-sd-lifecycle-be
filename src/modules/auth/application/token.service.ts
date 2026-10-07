import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenClaims, AuthUser } from '../domain/auth-user';

export interface IssuedToken {
  accessToken: string;
  /** Lifetime in seconds. */
  expiresIn: number;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  issue(user: AuthUser): IssuedToken {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email };
    const accessToken = this.jwt.sign(claims);
    const { iat, exp } = this.jwt.decode<{ iat: number; exp: number }>(accessToken);
    return { accessToken, expiresIn: exp - iat };
  }

  /** Returns the claims of a valid, unexpired token or null. */
  verify(token: string): AccessTokenClaims | null {
    try {
      const claims = this.jwt.verify<AccessTokenClaims>(token);
      return typeof claims.sub === 'string' ? claims : null;
    } catch {
      return null;
    }
  }
}
