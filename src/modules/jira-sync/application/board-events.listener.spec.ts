import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { createEvent, DomainEventOf, DomainEventType } from '../../../common/events';
import { BoardEventsListener } from './board-events.listener';
import { JiraConnectionService, JiraConnectionInternal } from './jira-connection.service';
import { ATLASSIAN_OAUTH, AtlassianOAuth } from './atlassian-oauth.port';
import { TOKEN_CIPHER, TokenCipher } from './token-cipher.port';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

const mockCardSnapshot = {
  id: 'card-1',
  boardId: 'board-1',
  columnId: 'col-1',
  title: 'Test Card',
  description: 'Test Description',
  deadline: null,
  jiraIssueKey: null,
  position: 0,
  assigneeId: null,
  labelIds: [],
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
};

const mockConnection: JiraConnectionInternal = {
  boardId: 'board-1',
  cloudId: 'cloud-1',
  siteUrl: 'https://example.atlassian.net',
  accessTokenEnc: 'encrypted-token',
  refreshTokenEnc: null,
  scopes: ['read:jira-work', 'write:jira-work'],
};

const createMockEvent = <T extends DomainEventType>(
  type: T,
  overrides: Partial<DomainEventOf<T>> = {},
): DomainEventOf<T> => {
  const base = createEvent(type, {
    boardId: 'board-1',
    actorId: 'user-1',
    origin: 'user',
    payload: mockCardSnapshot as any,
  });
  return { ...base, ...overrides } as DomainEventOf<T>;
};

const createMovedEvent = (
  overrides: Partial<DomainEventOf<'card.moved'>> = {},
): DomainEventOf<'card.moved'> => {
  const base = createEvent('card.moved', {
    boardId: 'board-1',
    actorId: 'user-1',
    origin: 'user',
    payload: {
      card: mockCardSnapshot,
      fromColumnId: 'col-1',
      toColumnId: 'col-2',
      position: 0,
    },
  });
  return { ...base, ...overrides } as DomainEventOf<'card.moved'>;
};

const createCommentedEvent = (
  overrides: Partial<DomainEventOf<'card.commented'>> = {},
): DomainEventOf<'card.commented'> => {
  const base = createEvent('card.commented', {
    boardId: 'board-1',
    actorId: 'user-1',
    origin: 'user',
    payload: {
      id: 'comment-1',
      cardId: 'card-1',
      authorId: 'user-1',
      text: 'Test comment',
      syncedToJira: false,
      createdAt: '2026-10-03T00:00:00.000Z',
    },
  });
  return { ...base, ...overrides } as DomainEventOf<'card.commented'>;
};

const createBoardUpdatedEvent = (
  overrides: Partial<DomainEventOf<'board.updated'>> = {},
): DomainEventOf<'board.updated'> => {
  const base = createEvent('board.updated', {
    boardId: 'board-1',
    actorId: 'user-1',
    origin: 'user',
    payload: {
      board: {
        id: 'board-1',
        title: 'Test Board',
        description: null,
        jiraProjectKey: 'KAN',
        createdAt: '2026-10-03T00:00:00.000Z',
        updatedAt: '2026-10-03T00:00:00.000Z',
      },
    },
  });
  return { ...base, ...overrides } as DomainEventOf<'board.updated'>;
};

describe('BoardEventsListener', () => {
  let module: TestingModule;
  let listener: BoardEventsListener;
  let eventEmitter: EventEmitter2;
  let connectionService: jest.Mocked<JiraConnectionService>;
  let jiraClient: jest.Mocked<AtlassianOAuth>;
  let tokenCipher: jest.Mocked<TokenCipher>;
  let issueMappings: jest.Mocked<Repository<JiraIssueMappingEntity>>;

  beforeEach(async () => {
    connectionService = {
      getConnectionForSync: jest.fn(),
      getStatus: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    jiraClient = {
      createIssue: jest.fn(),
      updateIssue: jest.fn(),
      getTransitions: jest.fn(),
      transitionIssue: jest.fn(),
      addComment: jest.fn(),
      exchangeCode: jest.fn(),
      listAccessibleResources: jest.fn(),
    } as any;

    tokenCipher = {
      encrypt: jest.fn(),
      decrypt: jest.fn().mockReturnValue('decrypted-token'),
    } as any;

    issueMappings = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    } as any;

    eventEmitter = new EventEmitter2();

    module = await Test.createTestingModule({
      providers: [
        BoardEventsListener,
        { provide: JiraConnectionService, useValue: connectionService },
        { provide: ATLASSIAN_OAUTH, useValue: jiraClient },
        { provide: TOKEN_CIPHER, useValue: tokenCipher },
        { provide: getRepositoryToken(JiraIssueMappingEntity), useValue: issueMappings },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    // Default mock for listAccessibleResources used by getProjectKey
    jiraClient.listAccessibleResources.mockResolvedValue([]);

    listener = module.get(BoardEventsListener);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('shouldIgnore', () => {
    it('returns true for origin: jira', () => {
      const event = createMockEvent('card.created', { origin: 'jira' });
      expect((listener as any).shouldIgnore(event)).toBe(true);
    });

    it('returns false for origin: user', () => {
      const event = createMockEvent('card.created', { origin: 'user' });
      expect((listener as any).shouldIgnore(event)).toBe(false);
    });

    it('logs debug message when ignoring jira origin', async () => {
      const event = createMockEvent('card.updated', { origin: 'jira' });
      await listener.onCardUpdated(event);
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.stringContaining("origin is 'jira'"),
      );
    });
  });

  describe('onCardCreated', () => {
    it('returns early when origin is jira', async () => {
      const event = createMockEvent('card.created', { origin: 'jira' });
      await listener.onCardCreated(event);
      expect(connectionService.getConnectionForSync).not.toHaveBeenCalled();
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('returns early when card already has jiraIssueKey', async () => {
      const event = createMockEvent('card.created', {
        payload: { ...mockCardSnapshot, jiraIssueKey: 'KAN-123' },
      });
      await listener.onCardCreated(event);
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
    });

    it('creates Jira issue when origin is user and no existing mapping', async () => {
      connectionService.getConnectionForSync.mockResolvedValue(mockConnection);
      issueMappings.findOne.mockResolvedValue(null);
      jiraClient.createIssue.mockResolvedValue({
        id: '12345',
        key: 'KAN-123',
        self: 'https://example.atlassian.net/rest/api/3/issue/12345',
      });
      issueMappings.create.mockReturnValue({
        boardId: 'board-1',
        cardId: 'card-1',
        jiraIssueKey: 'KAN-123',
        jiraIssueId: '12345',
        jiraProjectKey: 'KAN',
        createdById: 'user-1',
      } as JiraIssueMappingEntity);
      issueMappings.save.mockResolvedValue({} as any);

      const event = createMockEvent('card.created');
      await listener.onCardCreated(event);

      expect(connectionService.getConnectionForSync).toHaveBeenCalledWith('board-1');
      expect(jiraClient.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'decrypted-token',
          cloudId: 'cloud-1',
          siteUrl: 'https://example.atlassian.net',
          fields: expect.objectContaining({ summary: 'Test Card' }),
        }),
      );
      expect(issueMappings.save).toHaveBeenCalled();
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Created Jira issue KAN-123'),
      );
    });

    it('logs warning and returns when no connection exists', async () => {
      connectionService.getConnectionForSync.mockResolvedValue(null);

      const event = createMockEvent('card.created');
      await listener.onCardCreated(event);

      expect(connectionService.getConnectionForSync).toHaveBeenCalledWith('board-1');
      expect(jiraClient.createIssue).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('No Jira connection found'),
      );
    });

    it('logs error when token decryption fails', async () => {
      connectionService.getConnectionForSync.mockResolvedValue(mockConnection);
      tokenCipher.decrypt.mockImplementation(() => {
        throw new Error('decryption failed');
      });

      const event = createMockEvent('card.created');
      await listener.onCardCreated(event);

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to decrypt access token'),
        expect.anything(),
      );
    });

    it('logs error and continues when createIssue throws', async () => {
      connectionService.getConnectionForSync.mockResolvedValue(mockConnection);
      issueMappings.findOne.mockResolvedValue(null);
      jiraClient.createIssue.mockRejectedValue(new Error('Jira API error'));

      const event = createMockEvent('card.created');
      await listener.onCardCreated(event);

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create Jira issue'),
        expect.anything(),
      );
    });
  });

  describe('onCardUpdated', () => {
    it('returns early when origin is jira', async () => {
      const event = createMockEvent('card.updated', { origin: 'jira' });
      await listener.onCardUpdated(event);
      expect(jiraClient.updateIssue).not.toHaveBeenCalled();
    });

    it('returns early when no issue mapping exists', async () => {
      issueMappings.findOne.mockResolvedValue(null);
      const event = createMockEvent('card.updated');
      await listener.onCardUpdated(event);
      expect(jiraClient.updateIssue).not.toHaveBeenCalled();
    });

    it('updates Jira issue when origin is user and mapping exists', async () => {
      issueMappings.findOne.mockResolvedValue({ jiraIssueKey: 'KAN-123' } as any);
      connectionService.getConnectionForSync.mockResolvedValue(mockConnection);
      jiraClient.updateIssue.mockResolvedValue(undefined);

      const event = createMockEvent('card.updated', {
        payload: { ...mockCardSnapshot, title: 'Updated Title' },
      });
      await listener.onCardUpdated(event);

      expect(jiraClient.updateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          issueKey: 'KAN-123',
          fields: expect.objectContaining({ summary: 'Updated Title' }),
        }),
      );
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Updated Jira issue KAN-123'),
      );
    });

    it('skips when no updatable fields provided', async () => {
      issueMappings.findOne.mockResolvedValue({ jiraIssueKey: 'KAN-123' } as any);
      const event = createMockEvent('card.updated', {
        payload: { ...mockCardSnapshot, title: undefined, description: undefined },
      });
      await listener.onCardUpdated(event);
      expect(jiraClient.updateIssue).not.toHaveBeenCalled();
    });

    it('logs warning when no connection', async () => {
      issueMappings.findOne.mockResolvedValue({ jiraIssueKey: 'KAN-123' } as any);
      connectionService.getConnectionForSync.mockResolvedValue(null);

      const event = createMockEvent('card.updated');
      await listener.onCardUpdated(event);

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('No Jira connection found'),
      );
    });
  });

  describe('onCardMoved', () => {
    it('returns early when origin is jira', async () => {
      const event = createMovedEvent({ origin: 'jira' });
      await listener.onCardMoved(event);
      expect(jiraClient.getTransitions).not.toHaveBeenCalled();
    });

    it('returns early when no issue mapping exists', async () => {
      issueMappings.findOne.mockResolvedValue(null);
      const event = createMovedEvent();
      await listener.onCardMoved(event);
      expect(jiraClient.getTransitions).not.toHaveBeenCalled();
    });

    it('transitions issue when mapping and connection exist', async () => {
      issueMappings.findOne.mockResolvedValue({ jiraIssueKey: 'KAN-123' } as any);
      connectionService.getConnectionForSync.mockResolvedValue(mockConnection);
      jiraClient.getTransitions.mockResolvedValue({
        transitions: [{ id: '31', name: 'Done', to: { statusCategory: { key: 'done' } } }],
      });
      jiraClient.transitionIssue.mockResolvedValue(undefined);

      const event = createMovedEvent();
      await listener.onCardMoved(event);

      expect(jiraClient.getTransitions).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: 'KAN-123' }),
      );
      expect(jiraClient.transitionIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: 'KAN-123', transitionId: '31' }),
      );
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Transitioned Jira issue KAN-123'),
      );
    });

    it('logs warning when no transition found', async () => {
      issueMappings.findOne.mockResolvedValue({ jiraIssueKey: 'KAN-123' } as any);
      connectionService.getConnectionForSync.mockResolvedValue(mockConnection);
      jiraClient.getTransitions.mockResolvedValue({ transitions: [] });

      const event = createMovedEvent();
      await listener.onCardMoved(event);

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('No transition mapping'),
      );
    });
  });

  describe('onCardCommented', () => {
    it('returns early when origin is jira', async () => {
      const event = createCommentedEvent({ origin: 'jira' });
      await listener.onCardCommented(event);
      expect(jiraClient.addComment).not.toHaveBeenCalled();
    });

    it('returns early when no issue mapping exists', async () => {
      issueMappings.findOne.mockResolvedValue(null);
      const event = createCommentedEvent();
      await listener.onCardCommented(event);
      expect(jiraClient.addComment).not.toHaveBeenCalled();
    });

    it('adds comment when mapping and connection exist', async () => {
      issueMappings.findOne.mockResolvedValue({ jiraIssueKey: 'KAN-123' } as any);
      connectionService.getConnectionForSync.mockResolvedValue(mockConnection);
      jiraClient.addComment.mockResolvedValue(undefined);

      const event = createCommentedEvent();
      await listener.onCardCommented(event);

      expect(jiraClient.addComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issueKey: 'KAN-123',
          body: 'Test comment',
        }),
      );
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('Added comment to Jira issue KAN-123'),
      );
    });
  });

  describe('onBoardUpdated', () => {
    it('logs debug when origin is jira', () => {
      const event = createBoardUpdatedEvent({ origin: 'jira' });
      listener.onBoardUpdated(event);
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.stringContaining("Ignoring board.updated for board board-1: origin is 'jira'"),
      );
    });

    it('logs debug for user origin', () => {
      const event = createBoardUpdatedEvent({ origin: 'user' });
      listener.onBoardUpdated(event);
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.stringContaining('Board updated event received'),
      );
    });
  });
});
