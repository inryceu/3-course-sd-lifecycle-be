import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../../domain/auth-user';

/**
 * Returns the authenticated user, or one of its fields: `@CurrentUser()` or `@CurrentUser('id')`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    return field ? user?.[field] : user;
  },
);
