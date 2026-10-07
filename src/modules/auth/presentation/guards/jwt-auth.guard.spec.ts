import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../../../../common/decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

class PublicController {
  @Public()
  open() {
    return 'open';
  }

  closed() {
    return 'closed';
  }
}

const contextFor = (handler: () => unknown, type = 'http'): ExecutionContext =>
  ({
    getType: () => type,
    getHandler: () => handler,
    getClass: () => PublicController,
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(new Reflector());
  const controller = new PublicController();

  it('lets routes marked @Public() through without a token', () => {
    expect(guard.canActivate(contextFor(controller.open))).toBe(true);
  });

  it('does not interfere with non-HTTP contexts such as WebSocket handlers', () => {
    expect(guard.canActivate(contextFor(controller.closed, 'ws'))).toBe(true);
  });

  it('delegates unmarked routes to the JWT strategy', () => {
    const delegate = jest
      .spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: () => unknown },
        'canActivate',
      )
      .mockReturnValue(false);

    expect(guard.canActivate(contextFor(controller.closed))).toBe(false);
    expect(delegate).toHaveBeenCalledTimes(1);
    delegate.mockRestore();
  });

  describe('handleRequest', () => {
    it('returns the user when authentication succeeded', () => {
      const user = { id: 'u1' };
      expect(guard.handleRequest(null, user)).toBe(user);
    });

    it('throws Unauthorized when there is no user', () => {
      expect(() => guard.handleRequest(null, false)).toThrow(UnauthorizedException);
    });

    it('rethrows the strategy error', () => {
      const failure = new UnauthorizedException('Invalid or expired token');
      expect(() => guard.handleRequest(failure, false)).toThrow(failure);
    });
  });
});
