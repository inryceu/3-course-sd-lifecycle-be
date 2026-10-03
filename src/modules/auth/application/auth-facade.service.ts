import { Injectable } from '@nestjs/common';
import { AuthUser } from '../domain/auth-user';
import { AuthFacade } from './auth-facade.port';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthFacadeService implements AuthFacade {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  getUserById(id: string): Promise<AuthUser | null> {
    return this.auth.getUser(id);
  }

  async verifyToken(token: string): Promise<AuthUser | null> {
    const claims = this.tokens.verify(token);
    return claims ? this.auth.getUser(claims.sub) : null;
  }
}
