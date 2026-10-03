import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { Namespace, Socket } from 'socket.io';
import { BOARD_ACCESS, BoardAccess } from '../../../common/ports';
import { AUTH_FACADE, AuthFacade } from '../../auth';
import { boardRoom, userRoom } from '../application/rooms';

export interface JoinAck {
  ok: boolean;
  error?: 'forbidden' | 'bad-request';
}

interface SocketData {
  userId: string;
}

/**
 * Socket.IO gateway on the HTTP port, namespace `/realtime` (see docs/api/ws-events.md).
 *
 * - Handshake: a valid access token in `auth.token` (or an Authorization header) is required, the
 *   verification happens in a namespace middleware so an unauthenticated socket never connects.
 * - Rooms: `board:{boardId}` after an access check, and the personal room `user:{userId}`.
 */
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Namespace;

  constructor(
    @Inject(AUTH_FACADE) private readonly auth: AuthFacade,
    @Inject(BOARD_ACCESS) private readonly boardAccess: BoardAccess,
  ) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      void this.authenticate(socket).then(
        (userId) => {
          if (!userId) {
            next(new Error('unauthorized'));
            return;
          }
          (socket.data as SocketData).userId = userId;
          void socket.join(userRoom(userId));
          next();
        },
        () => next(new Error('unauthorized')),
      );
    });
  }

  @SubscribeMessage('board:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { boardId?: unknown },
  ): Promise<JoinAck> {
    const boardId = body?.boardId;
    if (typeof boardId !== 'string' || !isUUID(boardId)) {
      return { ok: false, error: 'bad-request' };
    }
    const { userId } = client.data as SocketData;
    if (!(await this.boardAccess.canView(userId, boardId))) {
      return { ok: false, error: 'forbidden' };
    }
    await client.join(boardRoom(boardId));
    return { ok: true };
  }

  @SubscribeMessage('board:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { boardId?: unknown },
  ): Promise<JoinAck> {
    const boardId = body?.boardId;
    if (typeof boardId !== 'string' || !isUUID(boardId)) {
      return { ok: false, error: 'bad-request' };
    }
    await client.leave(boardRoom(boardId));
    return { ok: true };
  }

  /** Delivers an event to every client in a room. */
  emitToRoom(room: string, event: string, payload: unknown): void {
    this.server.to(room).emit(event, payload);
  }

  private async authenticate(socket: Socket): Promise<string | null> {
    const handshakeToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const header = socket.handshake.headers.authorization;
    const token =
      typeof handshakeToken === 'string'
        ? handshakeToken
        : header?.startsWith('Bearer ')
          ? header.slice('Bearer '.length)
          : undefined;
    if (!token) {
      return null;
    }
    const user = await this.auth.verifyToken(token);
    if (!user) {
      this.logger.debug('Rejected a realtime handshake with an invalid token');
    }
    return user?.id ?? null;
  }
}
