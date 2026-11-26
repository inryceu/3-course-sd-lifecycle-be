import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { BoardEntity } from '../src/modules/boards/infrastructure/persistence/board.entity';
import { CardEntity } from '../src/modules/boards/infrastructure/persistence/card.entity';
import { bearer, createBoard, createCard, PREFIX, registerUser, TestUser } from './helpers';
import { undocumentedRoute } from './openapi-skip';

interface OutboxRow {
  status: string;
  payload: { targetColumnId: string };
}

describe('Cards -> outbox (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: TestUser;
  let counter = 0;

  const move = (cardId: string, columnId: string) =>
    request(app.getHttpServer())
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(admin))
      .send({ columnId, position: 0 });

  const rowsFor = (cardId: string): Promise<OutboxRow[]> =>
    dataSource.query(
      `SELECT status, payload FROM sync_outbox WHERE card_id = $1 ORDER BY sequence`,
      [cardId],
    );

  const setup = async (linked: boolean) => {
    const board = await createBoard(app, admin, 'Outbox board');
    const [todo, doing, done] = board.columns;
    const card = await createCard(app, admin, todo.id, 'Card');
    if (linked) {
      await dataSource.getRepository(BoardEntity).update(board.id, { jiraProjectKey: 'KAN' });
      await dataSource
        .getRepository(CardEntity)
        .update(card.id, { jiraIssueKey: `KAN-${++counter}` });
    }
    return { card, todo, doing, done };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    admin = await registerUser(app, 'cards-outbox-admin');
  });

  afterAll(() => app.close());

  afterEach(() => jest.restoreAllMocks());

  it('enqueues one PENDING row in the same transaction as a linked move', async () => {
    const { card, done } = await setup(true);
    await move(card.id, done.id).expect(200);
    const rows = await rowsFor(card.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].payload.targetColumnId).toBe(done.id);
  });

  it('coalesces A->B->C into one PENDING row with the latest target', async () => {
    const { card, doing, done } = await setup(true);
    await move(card.id, doing.id).expect(200);
    await move(card.id, done.id).expect(200);
    const rows = await rowsFor(card.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.targetColumnId).toBe(done.id);
  });

  it('does not enqueue for a card without a Jira issue key', async () => {
    const { card, done } = await setup(false);
    await move(card.id, done.id).expect(200);
    expect(await rowsFor(card.id)).toHaveLength(0);
  });

  it('does not enqueue for a reorder inside the same column', async () => {
    const { card, todo } = await setup(true);
    await move(card.id, todo.id).expect(200);
    expect(await rowsFor(card.id)).toHaveLength(0);
  });

  it('rolls the move back when the outbox insert fails', async () => {
    const { card, todo, done } = await setup(true);
    jest.spyOn(app.get(OutboxService), 'enqueue').mockRejectedValueOnce(new Error('boom'));

    // A forced 500 is a fault injection, not a documented response of the move operation.
    const res = await undocumentedRoute(move(card.id, done.id));
    expect(res.status).toBeGreaterThanOrEqual(500);

    const current = await request(app.getHttpServer())
      .get(`${PREFIX}/cards/${card.id}`)
      .set(bearer(admin))
      .expect(200);
    expect((current.body as { columnId: string }).columnId).toBe(todo.id);
    expect(await rowsFor(card.id)).toHaveLength(0);
  });
});
