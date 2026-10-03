import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthUser } from '../../domain/auth-user';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';

/**
 * Registered globally (APP_GUARD): every HTTP route needs a valid access token unless it is
 * marked with `@Public()`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }

  handleRequest<T = AuthUser>(error: unknown, user: T | false): T {
    if (error || !user) {
      throw error instanceof Error ? error : new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }
}
