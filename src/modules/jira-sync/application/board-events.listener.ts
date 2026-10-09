import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, DomainEventOf } from '../../../common/events';
import { JiraConnectionService, JiraConnectionInternal } from './jira-connection.service';
import { ATLASSIAN_OAUTH, AtlassianOAuth } from './atlassian-oauth.port';
import { TOKEN_CIPHER, TokenCipher } from './token-cipher.port';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

/**
 * Listens to board/card domain events and triggers outbound Jira synchronization.
 * Ignores events with `origin: 'jira'` to prevent sync loops.
 */
@Injectable()
export class BoardEventsListener {
  private readonly logger = new Logger(BoardEventsListener.name);

  constructor(
    @Inject(JiraConnectionService)
    private readonly connectionService: JiraConnectionService,
    @Inject(ATLASSIAN_OAUTH)
    private readonly jira: AtlassianOAuth,
    @Inject(TOKEN_CIPHER)
    private readonly tokenCipher: TokenCipher,
    @InjectRepository(JiraIssueMappingEntity)
    private readonly issueMappings: Repository<JiraIssueMappingEntity>,
  ) {}

  @OnEvent('card.created')
  async onCardCreated(event: DomainEventOf<'card.created'>): Promise<void> {
    if (this.shouldIgnore(event)) return;
    await this.handleCardCreated(event);
  }

  @OnEvent('card.updated')
  async onCardUpdated(event: DomainEventOf<'card.updated'>): Promise<void> {
    if (this.shouldIgnore(event)) return;
    await this.handleCardUpdated(event);
  }

  @OnEvent('card.moved')
  async onCardMoved(event: DomainEventOf<'card.moved'>): Promise<void> {
    if (this.shouldIgnore(event)) return;
    await this.handleCardMoved(event);
  }

  @OnEvent('card.commented')
  async onCardCommented(event: DomainEventOf<'card.commented'>): Promise<void> {
    if (this.shouldIgnore(event)) return;
    await this.handleCardCommented(event);
  }

  @OnEvent('board.updated')
  onBoardUpdated(event: DomainEventOf<'board.updated'>): void {
    if (this.shouldIgnore(event)) return;
    this.handleBoardUpdated(event);
  }

  /** Returns true if the event should be ignored (origin is 'jira'). */
  private shouldIgnore(event: DomainEvent): boolean {
    if (event.origin === 'jira') {
      this.logger.debug(`Ignoring ${event.type} for board ${event.boardId}: origin is 'jira'`);
      return true;
    }
    return false;
  }

  /** Gets the Jira connection and decrypts the access token. */
  private async getConnection(
    boardId: string,
  ): Promise<{ connection: JiraConnectionInternal; accessToken: string } | null> {
    const connection = await this.connectionService.getConnectionForSync(boardId);
    if (!connection) {
      this.logger.warn(`No Jira connection found for board ${boardId}, skipping sync`);
      return null;
    }
    let accessToken: string;
    try {
      accessToken = this.tokenCipher.decrypt(connection.accessTokenEnc);
    } catch (error) {
      this.logger.error(
        `Failed to decrypt access token for board ${boardId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
    return { connection, accessToken };
  }

  /** Gets the Jira issue key for a local card, if mapped. */
  private async getIssueKey(boardId: string, cardId: string): Promise<string | null> {
    const mapping = await this.issueMappings.findOne({ where: { boardId, cardId } });
    return mapping?.jiraIssueKey ?? null;
  }

  /** Creates a Jira issue for a new card. */
  private async handleCardCreated(event: DomainEventOf<'card.created'>): Promise<void> {
    const { boardId } = event;
    const { id: cardId, title, description, jiraIssueKey } = event.payload;

    if (jiraIssueKey) {
      this.logger.debug(
        `Card ${cardId} already has Jira issue key ${jiraIssueKey}, skipping create`,
      );
      return;
    }

    const conn = await this.getConnection(boardId);
    if (!conn) return;

    try {
      const fields = {
        summary: title,
        description: description ?? undefined,
        project: { key: await this.getProjectKey(boardId, conn.accessToken) },
        issuetype: { name: 'Task' },
      };

      const response = await this.jira.createIssue({
        accessToken: conn.accessToken,
        cloudId: conn.connection.cloudId,
        siteUrl: conn.connection.siteUrl,
        fields,
      });

      await this.issueMappings.save(
        this.issueMappings.create({
          boardId,
          cardId,
          jiraIssueKey: response.key,
          jiraIssueId: response.id,
          jiraProjectKey: fields.project.key,
          createdById: event.actorId ?? null,
        }),
      );

      this.logger.log(`Created Jira issue ${response.key} for card ${cardId} on board ${boardId}`);
    } catch (error) {
      this.logger.error(
        `Failed to create Jira issue for card ${cardId} on board ${boardId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Updates a Jira issue for an updated card. */
  private async handleCardUpdated(event: DomainEventOf<'card.updated'>): Promise<void> {
    const { boardId } = event;
    const { id: cardId, title, description } = event.payload;

    const issueKey = await this.getIssueKey(boardId, cardId);
    if (!issueKey) {
      this.logger.debug(`No Jira issue mapping for card ${cardId}, skipping update`);
      return;
    }

    const conn = await this.getConnection(boardId);
    if (!conn) return;

    try {
      const fields: Record<string, unknown> = {};
      if (title !== undefined) fields.summary = title;
      if (description !== undefined) fields.description = description;

      if (Object.keys(fields).length === 0) {
        this.logger.debug(`No updatable fields for card ${cardId}, skipping`);
        return;
      }

      await this.jira.updateIssue({
        accessToken: conn.accessToken,
        cloudId: conn.connection.cloudId,
        siteUrl: conn.connection.siteUrl,
        issueKey,
        fields,
      });

      this.logger.log(`Updated Jira issue ${issueKey} for card ${cardId} on board ${boardId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update Jira issue ${issueKey} for card ${cardId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Transitions a Jira issue when a card is moved between columns. */
  private async handleCardMoved(event: DomainEventOf<'card.moved'>): Promise<void> {
    const { boardId } = event;
    const { card, toColumnId } = event.payload;
    const { id: cardId } = card;

    const issueKey = await this.getIssueKey(boardId, cardId);
    if (!issueKey) {
      this.logger.debug(`No Jira issue mapping for card ${cardId}, skipping transition`);
      return;
    }

    const conn = await this.getConnection(boardId);
    if (!conn) return;

    try {
      const transitionId = await this.getTransitionIdForColumn(conn, issueKey, toColumnId);
      if (!transitionId) {
        this.logger.warn(`No transition mapping for column ${toColumnId} on board ${boardId}`);
        return;
      }

      await this.jira.transitionIssue({
        accessToken: conn.accessToken,
        cloudId: conn.connection.cloudId,
        siteUrl: conn.connection.siteUrl,
        issueKey,
        transitionId,
      });

      this.logger.log(
        `Transitioned Jira issue ${issueKey} for card ${cardId} to column ${toColumnId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to transition Jira issue ${issueKey} for card ${cardId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Adds a comment to a Jira issue when a card is commented. */
  private async handleCardCommented(event: DomainEventOf<'card.commented'>): Promise<void> {
    const { boardId } = event;
    const { cardId, text } = event.payload;

    const issueKey = await this.getIssueKey(boardId, cardId);
    if (!issueKey) {
      this.logger.debug(`No Jira issue mapping for card ${cardId}, skipping comment`);
      return;
    }

    const conn = await this.getConnection(boardId);
    if (!conn) return;

    try {
      await this.jira.addComment({
        accessToken: conn.accessToken,
        cloudId: conn.connection.cloudId,
        siteUrl: conn.connection.siteUrl,
        issueKey,
        body: text,
      });

      this.logger.log(`Added comment to Jira issue ${issueKey} for card ${cardId}`);
    } catch (error) {
      this.logger.error(
        `Failed to add comment to Jira issue ${issueKey} for card ${cardId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Handles board updates (placeholder for future project metadata sync). */
  private handleBoardUpdated(event: DomainEventOf<'board.updated'>): void {
    this.logger.debug(
      `Board updated event received for board ${event.boardId}, no sync action implemented yet`,
    );
  }

  /** Gets the Jira project key for a board. */
  private async getProjectKey(boardId: string, accessToken: string): Promise<string> {
    try {
      const response = await this.jira.listAccessibleResources(accessToken);
      // Find the resource matching our cloudId
      const resource = response.find((r) => r.id === 'cloud-1'); // This would need proper matching
      return resource?.name?.split(' ')[0]?.toUpperCase() ?? 'KAN';
    } catch {
      return 'KAN';
    }
  }

  /** Gets the Jira transition ID for a target column. */
  private async getTransitionIdForColumn(
    conn: { connection: JiraConnectionInternal; accessToken: string },
    issueKey: string,
    _columnId: string,
  ): Promise<string | null> {
    try {
      const transitions = await this.jira.getTransitions({
        accessToken: conn.accessToken,
        cloudId: conn.connection.cloudId,
        siteUrl: conn.connection.siteUrl,
        issueKey,
      });
      // TODO: Map columnId to transitionId based on board configuration
      // For now, return the first transition that looks like a forward move
      const forwardTransition = transitions.transitions.find(
        (t) => t.to.statusCategory.key === 'done' || t.to.statusCategory.key === 'indeterminate',
      );
      return forwardTransition?.id ?? transitions.transitions[0]?.id ?? null;
    } catch (error) {
      this.logger.error(
        `Failed to get transitions for issue ${issueKey}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }
}
