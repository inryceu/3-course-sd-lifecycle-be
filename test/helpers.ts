import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export const PREFIX = '/api/v1';

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export const uniqueEmail = (label = 'user') => `${label}-${randomUUID()}@example.com`;

export async function registerUser(
  app: INestApplication,
  label = 'user',
  password = 'correct horse battery',
): Promise<TestUser> {
  const email = uniqueEmail(label);
  const response = await request(app.getHttpServer())
    .post(`${PREFIX}/auth/register`)
    .send({ email, password, displayName: label })
    .expect(201);
  const body = response.body as { accessToken: string; user: { id: string } };
  return { id: body.user.id, email, token: body.accessToken };
}

export const bearer = (user: { token: string }) => ({ Authorization: `Bearer ${user.token}` });

export interface ColumnBody {
  id: string;
  boardId: string;
  title: string;
  type: string;
  position: number;
  cards?: CardBody[];
}

export interface CardBody {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  position: number;
  jiraIssueKey: string | null;
  assigneeId: string | null;
  labelIds: string[];
}

export interface BoardBody {
  id: string;
  title: string;
  myRole: string;
  columns: ColumnBody[];
}

export async function createBoard(
  app: INestApplication,
  owner: TestUser,
  title = 'Board',
): Promise<BoardBody> {
  const response = await request(app.getHttpServer())
    .post(`${PREFIX}/boards`)
    .set(bearer(owner))
    .send({ title })
    .expect(201);
  return response.body as BoardBody;
}

export async function createCard(
  app: INestApplication,
  user: TestUser,
  columnId: string,
  title = 'Card',
): Promise<CardBody> {
  const response = await request(app.getHttpServer())
    .post(`${PREFIX}/columns/${columnId}/cards`)
    .set(bearer(user))
    .send({ title })
    .expect(201);
  return response.body as CardBody;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
