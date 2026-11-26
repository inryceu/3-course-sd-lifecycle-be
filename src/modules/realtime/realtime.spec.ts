import { Namespace, Socket } from 'socket.io';
import { createEvent, DOMAIN_EVENT_TYPES } from '../../common/events';
import { AuthFacade } from '../auth';
import { BoardEventsListener } from './application/board-events.listener';
import { boardRoom, userRoom } from './application/rooms';
import { originSocketMiddleware } from './presentation/origin-socket';
import { RealtimeGateway } from './presentation/realtime.gateway';

const BOARD = '3f1b5f0a-6a53-4a39-9f4f-6c1d2f9a1111';

const card = {
  id: 'c1',
  boardId: BOARD,
  columnId: 'col',
  title: 'T',
  description: null,
  deadline: null,
  jiraIssueKey: null,
  position: 0,
  assigneeId: null,
  labelIds: [],
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
};

function gateway(options: { user?: { id: string } | null; canView?: boolean } = {}) {
  const auth: AuthFacade = {
    getUserById: jest.fn(),
    getUserByEmail: jest.fn(),
    verifyToken: jest.fn().mockResolvedValue('user' in options ? options.user : { id: 'u1' }),
  };
  const boardAccess = { canView: jest.fn().mockResolvedValue(options.canView ?? true) };
  return { gw: new RealtimeGateway(auth, boardAccess), auth, boardAccess };
}

function fakeSocket(handshake: { auth?: object; headers?: Record<string, string> } = {}) {
  return {
    handshake: { auth: handshake.auth ?? {}, headers: handshake.headers ?? {} },
    data: {} as Record<string, unknown>,
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
  } as unknown as Socket & { join: jest.Mock; leave: jest.Mock };
}

/** Runs the namespace middleware registered by `afterInit` and returns the `next` argument. */
async function handshake(gw: RealtimeGateway, socket: Socket): Promise<Error | undefined> {
  let middleware!: (s: Socket, next: (err?: Error) => void) => void;
  gw.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as unknown as Namespace);
  return new Promise((resolve) => {
    middleware(socket, (err) => resolve(err));
  });
}

describe('RealtimeGateway handshake', () => {
  it('rejects a connection without a token', async () => {
    const { gw, auth } = gateway();
    const error = await handshake(gw, fakeSocket());
    expect(error?.message).toBe('unauthorized');
    expect(auth.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid token', async () => {
    const { gw } = gateway({ user: null });
    const error = await handshake(gw, fakeSocket({ auth: { token: 'bad' } }));
    expect(error?.message).toBe('unauthorized');
  });

  it('rejects when verification itself fails', async () => {
    const { gw, auth } = gateway();
    (auth.verifyToken as jest.Mock).mockRejectedValue(new Error('db down'));
    const error = await handshake(gw, fakeSocket({ auth: { token: 't' } }));
    expect(error?.message).toBe('unauthorized');
  });

  it('accepts a valid token from the handshake auth and joins the personal room', async () => {
    const { gw, auth } = gateway();
    const socket = fakeSocket({ auth: { token: 'good' } });

    const error = await handshake(gw, socket);

    expect(error).toBeUndefined();
    expect(auth.verifyToken).toHaveBeenCalledWith('good');
    expect(socket.data['userId']).toBe('u1');
    expect(socket.join).toHaveBeenCalledWith(userRoom('u1'));
  });

  it('accepts a bearer token from the Authorization header', async () => {
    const { gw, auth } = gateway();
    const error = await handshake(
      gw,
      fakeSocket({ headers: { authorization: 'Bearer from-header' } }),
    );
    expect(error).toBeUndefined();
    expect(auth.verifyToken).toHaveBeenCalledWith('from-header');
  });
});

describe('RealtimeGateway rooms', () => {
  const joined = (id = 'u1') => Object.assign(fakeSocket(), { data: { userId: id } });

  it('joins a board room when the user may view the board', async () => {
    const { gw, boardAccess } = gateway({ canView: true });
    const socket = joined();

    expect(await gw.handleJoin(socket, { boardId: BOARD })).toEqual({ ok: true });

    expect(boardAccess.canView).toHaveBeenCalledWith('u1', BOARD);
    expect(socket.join).toHaveBeenCalledWith(boardRoom(BOARD));
  });

  it('refuses a board the user cannot view and does not join', async () => {
    const { gw } = gateway({ canView: false });
    const socket = joined();

    expect(await gw.handleJoin(socket, { boardId: BOARD })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each([undefined, 42, 'not-a-uuid', {}])('rejects bad board id %p', async (boardId) => {
    const { gw, boardAccess } = gateway();
    const socket = joined();

    expect(await gw.handleJoin(socket, { boardId })).toEqual({ ok: false, error: 'bad-request' });
    expect(boardAccess.canView).not.toHaveBeenCalled();
  });

  it('leaves a board room', async () => {
    const { gw } = gateway();
    const socket = joined();
    expect(await gw.handleLeave(socket, { boardId: BOARD })).toEqual({ ok: true });
    expect(socket.leave).toHaveBeenCalledWith(boardRoom(BOARD));
  });
});

describe('BoardEventsListener', () => {
  const setup = (socketOwner?: string) => {
    const emitToRoom = jest.fn();
    const leaveRoom = jest.fn();
    const isSocketOf = jest.fn(
      (_socketId: string, userId: string) => socketOwner !== undefined && socketOwner === userId,
    );
    const listener = new BoardEventsListener({
      emitToRoom,
      leaveRoom,
      isSocketOf,
    } as unknown as RealtimeGateway);
    return { listener, emitToRoom, leaveRoom, isSocketOf };
  };

  /** Runs `fn` as if inside an HTTP request that carried `X-Socket-Id: socketId`. */
  const inRequestFrom = (socketId: string, fn: () => void) =>
    originSocketMiddleware({ header: () => socketId }, undefined, fn);

  it('delivers card events to the board room with the type as message name and the full envelope', () => {
    const { listener, emitToRoom } = setup();
    const event = createEvent('card.created', { boardId: BOARD, actorId: 'u1', payload: card });

    listener.onCardCreated(event);

    expect(emitToRoom).toHaveBeenCalledWith(boardRoom(BOARD), 'card.created', event, undefined);
  });

  it("skips the author's originating socket named in the request", () => {
    const { listener, emitToRoom, isSocketOf } = setup('u1');
    const event = createEvent('card.created', { boardId: BOARD, actorId: 'u1', payload: card });

    inRequestFrom('sock-1', () => listener.onCardCreated(event));

    expect(isSocketOf).toHaveBeenCalledWith('sock-1', 'u1');
    expect(emitToRoom).toHaveBeenCalledWith(boardRoom(BOARD), 'card.created', event, 'sock-1');
  });

  it('does not skip a socket that belongs to someone other than the author', () => {
    const { listener, emitToRoom } = setup('someone-else');
    const event = createEvent('card.created', { boardId: BOARD, actorId: 'u1', payload: card });

    inRequestFrom('sock-1', () => listener.onCardCreated(event));

    expect(emitToRoom).toHaveBeenCalledWith(boardRoom(BOARD), 'card.created', event, undefined);
  });

  it('evicts a removed member from the board room before announcing the removal', () => {
    const { listener, emitToRoom, leaveRoom } = setup();
    const event = createEvent('member.removed', {
      boardId: BOARD,
      actorId: 'admin',
      payload: { userId: 'u2' },
    });

    listener.onMemberRemoved(event);

    expect(leaveRoom).toHaveBeenCalledWith(userRoom('u2'), boardRoom(BOARD));
    expect(emitToRoom).toHaveBeenCalledWith(
      [boardRoom(BOARD), userRoom('u2')],
      'member.removed',
      event,
      undefined,
    );
    expect(leaveRoom.mock.invocationCallOrder[0]).toBeLessThan(
      emitToRoom.mock.invocationCallOrder[0],
    );
  });

  it('does not deliver an event to any other board room', () => {
    const { listener, emitToRoom } = setup();
    listener.onCardUpdated(createEvent('card.updated', { boardId: BOARD, payload: card }));
    expect(emitToRoom).toHaveBeenCalledTimes(1);
    expect(emitToRoom.mock.calls[0][0]).toBe(boardRoom(BOARD));
  });

  it("sends notifications to the recipient's personal room only", () => {
    const { listener, emitToRoom } = setup();
    const event = createEvent('notification.created', {
      boardId: BOARD,
      payload: {
        recipientId: 'u9',
        notification: {
          id: 'n1',
          type: 'deadline.reminder',
          payload: {},
          readAt: null,
          createdAt: 'x',
        },
      },
    });

    listener.onNotificationCreated(event);

    expect(emitToRoom).toHaveBeenCalledWith(userRoom('u9'), 'notification.created', event);
  });

  it('subscribes to every contract event type', () => {
    const subscribed = Object.getOwnPropertyNames(BoardEventsListener.prototype)
      .filter((name) => name.startsWith('on'))
      .map(
        (name) =>
          Reflect.getMetadata(
            'EVENT_LISTENER_METADATA',
            BoardEventsListener.prototype[name as keyof BoardEventsListener],
          ) as unknown,
      )
      .flat()
      .map((meta) => (meta as { event: string }).event)
      .sort();

    expect(subscribed).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });
});
