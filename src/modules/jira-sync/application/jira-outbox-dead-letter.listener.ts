import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SyncOutboxEntity } from '../../../common/outbox/infrastructure/persistence/sync-outbox.entity';
import { OutboxWorker } from '../../../common/outbox/outbox.worker';
import { BOARDS_FACADE, BoardRole, BoardsFacade } from '../../boards';

/**
 * On a terminal DEAD row notifies every board Admin and, when different, the mover.
 * Best-effort: a failure is logged and never changes the outbox row.
 */
@Injectable()
export class JiraOutboxDeadLetterListener implements OnModuleInit {
  private readonly logger = new Logger(JiraOutboxDeadLetterListener.name);

  constructor(
    private readonly worker: OutboxWorker,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
  ) {}

  onModuleInit(): void {
    this.worker.onDeadLettered((row) => this.notify(row));
  }

  async notify(row: SyncOutboxEntity): Promise<void> {
    if (row.operation !== 'TRANSITION_ISSUE') return;
    const payload = {
      outboxId: row.id,
      boardId: row.boardId,
      cardId: row.cardId,
      jiraIssueKey: row.payload['jiraIssueKey'] ?? null,
      operation: row.operation,
      attempts: row.attempts,
      errorCode: row.errorCode,
    };
    try {
      await this.boards.notifyBoardAdmins(row.boardId, 'jira.sync.failed', payload);
      if (row.actorId) {
        const role = await this.boards.getMemberRole(row.boardId, row.actorId);
        // An Admin mover was already covered by the admin fan-out.
        if (role !== null && role !== BoardRole.ADMIN) {
          await this.boards.notifyUser(row.actorId, row.boardId, 'jira.sync.failed', payload);
        }
      }
    } catch (error) {
      this.logger.warn(`Dead-letter notification failed for ${row.id}: ${String(error)}`);
    }
  }
}
