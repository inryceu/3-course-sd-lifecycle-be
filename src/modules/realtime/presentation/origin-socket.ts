import { AsyncLocalStorage } from 'node:async_hooks';

/** REST header with the caller's own Socket.IO id; its events are not echoed to that socket. */
export const ORIGIN_SOCKET_HEADER = 'X-Socket-Id';

const originSocket = new AsyncLocalStorage<string>();

/**
 * HTTP middleware that keeps `X-Socket-Id` for the rest of the request. Events are published
 * inside the request (see EventPublisher), so the realtime listener reads it from the same
 * async context. Must be registered after the JSON body parser, which would lose the context.
 */
export function originSocketMiddleware(
  req: { header(name: string): string | undefined },
  _res: unknown,
  next: () => void,
): void {
  const socketId = req.header(ORIGIN_SOCKET_HEADER);
  if (socketId) {
    originSocket.run(socketId, next);
  } else {
    next();
  }
}

/** The socket id sent with the current request, if any. */
export const originSocketId = (): string | undefined => originSocket.getStore();
