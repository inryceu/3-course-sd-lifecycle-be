import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { DomainEvent } from '../src/common/events';
import { BoardRole } from '../src/modules/boards';
import { BoardMembershipEntity } from '../src/modules/boards/infrastructure/persistence/board-membership.entity';
import { RealtimeGateway } from '../src/modules/realtime/presentation/realtime.gateway';
import {
  bearer,
  createBoard,
  createCard,
  createTestApp,
  PREFIX,
  registerUser,
  sleep,
  TestUser,
} from './helpers';

describe('Realtime delivery (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);
  });

  afterEach(() => {
    while (sockets.length) sockets.pop()?.close();
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(token?: string): Promise<Socket> {
    const socket = io(`${baseUrl}/realtime`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  const join = (socket: Socket, boardId: string) =>
    socket.emitWithAck('board:join', { boardId }) as Promise<{ ok: boolean; error?: string }>;

  function nextEvent(socket: Socket, name: string, timeoutMs = 3000): Promise<DomainEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no "${name}" within ${timeoutMs} ms`)),
        timeoutMs,
      );
      socket.once(name, (event: DomainEvent) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  async function expectSilence(socket: Socket, name: string, ms = 400): Promise<void> {
    let received = false;
    socket.once(name, () => (received = true));
    await sleep(ms);
    socket.off(name);
    expect(received).toBe(false);
  }

  /** Ids of the server-side sockets currently in a room. */
  async function roomSockets(room: string): Promise<string[]> {
    const found = await app.get(RealtimeGateway).server.in(room).fetchSockets();
    return found.map((s) => s.id);
  }

  async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > until) throw new Error('condition not met in time');
      await sleep(50);
    }
  }

  function nextDisconnect(socket: Socket, timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no disconnect')), timeoutMs);
      socket.once('disconnect', (reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });
  }

  function postCard(user: TestUser, columnId: string, socketId: string) {
    return request(app.getHttpServer())
      .post(`${PREFIX}/columns/${columnId}/cards`)
      .set(bearer(user))
      .set('X-Socket-Id', socketId)
      .send({ title: 'echo' })
      .expect(201);
  }

  async function addMember(boardId: string, user: TestUser, role: BoardRole) {
    await dataSource
      .getRepository(BoardMembershipEntity)
      .insert({ boardId, userId: user.id, role });
  }

  describe('handshake', () => {
    it('refuses a connection without a token', async () => {
      await expect(connect()).rejects.toMatchObject({ message: 'unauthorized' });
    });

    it('refuses an invalid token', async () => {
      await expect(connect('not-a-token')).rejects.toMatchObject({ message: 'unauthorized' });
    });

    it('accepts a valid access token', async () => {
      const user = await registerUser(app);
      const socket = await connect(user.token);
      expect(socket.connected).toBe(true);
    });
  });

  describe('rooms', () => {
    it('admits members of any role and refuses strangers without leaking the board', async () => {
      const owner = await registerUser(app, 'owner');
      const viewer = await registerUser(app, 'viewer');
      const stranger = await registerUser(app, 'stranger');
      const board = await createBoard(app, owner);
      await addMember(board.id, viewer, BoardRole.VIEWER);

      expect(await join(await connect(owner.token), board.id)).toEqual({ ok: true });
      expect(await join(await connect(viewer.token), board.id)).toEqual({ ok: true });
      expect(await join(await connect(stranger.token), board.id)).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect(await join(await connect(owner.token), 'not-a-uuid')).toEqual({
        ok: false,
        error: 'bad-request',
      });
    });

    it('delivers nothing to a client that was refused the room', async () => {
      const owner = await registerUser(app, 'owner');
      const stranger = await registerUser(app, 'stranger');
      const board = await createBoard(app, owner);
      const strangerSocket = await connect(stranger.token);
      await join(strangerSocket, board.id);

      const silence = expectSilence(strangerSocket, 'card.created');
      await createCard(app, owner, board.columns[0].id);
      await silence;
    });
  });

  describe('events', () => {
    it('delivers a card change to every client on the board, including the author, with the full envelope', async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      const ownerSocket = await connect(owner.token);
      const memberSocket = await connect(member.token);
      await join(ownerSocket, board.id);
      await join(memberSocket, board.id);

      const forOwner = nextEvent(ownerSocket, 'card.created');
      const forMember = nextEvent(memberSocket, 'card.created');
      const card = await createCard(app, owner, board.columns[0].id, 'live');

      for (const event of [await forOwner, await forMember]) {
        expect(event).toMatchObject({
          type: 'card.created',
          boardId: board.id,
          actorId: owner.id,
          origin: 'user',
          payload: { id: card.id, title: 'live', columnId: board.columns[0].id },
        });
        expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
      }
    });

    it('delivers card.moved and board.updated', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const socket = await connect(owner.token);
      await join(socket, board.id);
      const card = await createCard(app, owner, board.columns[0].id);

      const moved = nextEvent(socket, 'card.moved');
      await request(app.getHttpServer())
        .patch(`${PREFIX}/cards/${card.id}/move`)
        .set(bearer(owner))
        .send({ columnId: board.columns[1].id, position: 0 })
        .expect(200);
      expect((await moved).payload).toMatchObject({
        fromColumnId: board.columns[0].id,
        toColumnId: board.columns[1].id,
        position: 0,
      });

      const updated = nextEvent(socket, 'board.updated');
      await request(app.getHttpServer())
        .patch(`${PREFIX}/boards/${board.id}`)
        .set(bearer(owner))
        .send({ title: 'Renamed' })
        .expect(200);
      expect((await updated).payload).toMatchObject({ board: { id: board.id, title: 'Renamed' } });
    });

    it('does not deliver a change to clients of another board', async () => {
      const owner = await registerUser(app, 'owner');
      const boardA = await createBoard(app, owner, 'A');
      const boardB = await createBoard(app, owner, 'B');
      const onA = await connect(owner.token);
      const onB = await connect(owner.token);
      await join(onA, boardA.id);
      await join(onB, boardB.id);

      const received = nextEvent(onA, 'card.created');
      const silence = expectSilence(onB, 'card.created');
      await createCard(app, owner, boardA.columns[0].id);

      expect((await received).boardId).toBe(boardA.id);
      await silence;
    });

    it('stops delivering after leaving the board', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const socket = await connect(owner.token);
      await join(socket, board.id);
      expect(await socket.emitWithAck('board:leave', { boardId: board.id })).toEqual({ ok: true });

      const silence = expectSilence(socket, 'card.created');
      await createCard(app, owner, board.columns[0].id);
      await silence;
    });

    it('delivers card.commented over the socket', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const socket = await connect(owner.token);
      await join(socket, board.id);
      const card = await createCard(app, owner, board.columns[0].id);

      const commented = nextEvent(socket, 'card.commented');
      await request(app.getHttpServer())
        .post(`${PREFIX}/cards/${card.id}/comments`)
        .set(bearer(owner))
        .send({ text: 'hello' })
        .expect(201);
      expect(await commented).toMatchObject({
        type: 'card.commented',
        boardId: board.id,
        payload: { cardId: card.id, text: 'hello' },
      });
    });
  });

  describe('membership changes', () => {
    it('evicts a removed member from the board room immediately and tells them', async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      const ownerSocket = await connect(owner.token);
      const memberSocket = await connect(member.token);
      await join(ownerSocket, board.id);
      await join(memberSocket, board.id);

      const removedForMember = nextEvent(memberSocket, 'member.removed');
      const removedForOwner = nextEvent(ownerSocket, 'member.removed');
      await request(app.getHttpServer())
        .delete(`${PREFIX}/boards/${board.id}/members/${member.id}`)
        .set(bearer(owner))
        .expect(204);

      for (const event of [await removedForMember, await removedForOwner]) {
        expect(event).toMatchObject({
          type: 'member.removed',
          boardId: board.id,
          actorId: owner.id,
          origin: 'user',
          payload: { userId: member.id },
        });
      }
      expect(await roomSockets(`board:${board.id}`)).not.toContain(memberSocket.id);

      const forOwner = nextEvent(ownerSocket, 'card.created');
      const silence = expectSilence(memberSocket, 'card.created');
      await createCard(app, owner, board.columns[0].id);
      await forOwner;
      await silence;

      expect(await join(memberSocket, board.id)).toEqual({ ok: false, error: 'forbidden' });
    });

    it('keeps room access when the role changes to Viewer', async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      const memberSocket = await connect(member.token);
      await join(memberSocket, board.id);

      await request(app.getHttpServer())
        .patch(`${PREFIX}/boards/${board.id}/members/${member.id}`)
        .set(bearer(owner))
        .send({ role: BoardRole.VIEWER })
        .expect(200);

      const received = nextEvent(memberSocket, 'card.created');
      await createCard(app, owner, board.columns[0].id);
      expect((await received).boardId).toBe(board.id);
    });
  });

  describe('originating socket', () => {
    it("skips the socket named in X-Socket-Id but not the author's other sockets or other members", async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      const origin = await connect(owner.token);
      const otherTab = await connect(owner.token);
      const memberSocket = await connect(member.token);
      for (const socket of [origin, otherTab, memberSocket]) await join(socket, board.id);

      const silence = expectSilence(origin, 'card.created');
      const forOtherTab = nextEvent(otherTab, 'card.created');
      const forMember = nextEvent(memberSocket, 'card.created');
      await postCard(owner, board.columns[0].id, origin.id);

      await silence;
      await forOtherTab;
      await forMember;
    });

    it("ignores X-Socket-Id naming another user's socket", async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      const memberSocket = await connect(member.token);
      await join(memberSocket, board.id);

      const received = nextEvent(memberSocket, 'card.created');
      await postCard(owner, board.columns[0].id, memberSocket.id);
      await received;
    });
  });

  describe('heartbeat and clean-up', () => {
    it('announces the configured ping interval and timeout', async () => {
      const user = await registerUser(app);
      const socket = await connect(user.token);
      const engine = socket.io.engine as unknown as { _pingInterval: number; _pingTimeout: number };
      expect(engine._pingInterval).toBe(Number(process.env['REALTIME_PING_INTERVAL_MS']));
      expect(engine._pingTimeout).toBe(Number(process.env['REALTIME_PING_TIMEOUT_MS']));
    });

    it('removes a closed socket from the board room and the user room', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const socket = await connect(owner.token);
      await join(socket, board.id);
      const id = socket.id;
      expect(await roomSockets(`board:${board.id}`)).toEqual([id]);

      socket.close();

      await waitFor(async () => (await roomSockets(`board:${board.id}`)).length === 0);
      expect(await roomSockets(`user:${owner.id}`)).toEqual([]);
    });

    it('disconnects a client that stops answering pings and cleans up its rooms', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const socket = await connect(owner.token);
      await join(socket, board.id);
      // Swallow every outgoing packet, so the server's pings go unanswered.
      (socket.io.engine as unknown as { _sendPacket: () => void })._sendPacket = () => undefined;

      await nextDisconnect(socket);

      await waitFor(async () => (await roomSockets(`board:${board.id}`)).length === 0);
      expect(await roomSockets(`user:${owner.id}`)).toEqual([]);
    });
  });
});
