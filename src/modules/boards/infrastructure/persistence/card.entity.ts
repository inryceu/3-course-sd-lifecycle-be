import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import { CrossBoardMoveError, InvalidPositionError } from '../../domain/errors';
import type { BoardColumnEntity } from './column.entity';
import type { CommentEntity } from './comment.entity';
import type { LabelEntity } from './label.entity';

@Entity('cards')
@Index('IDX_cards_column_position', ['columnId', 'position'])
@Index('IDX_cards_board', ['boardId'])
@Index('UQ_cards_board_jira_issue', ['boardId', 'jiraIssueKey'], {
  unique: true,
  where: '"jiraIssueKey" IS NOT NULL',
})
export class CardEntity extends BaseEntity {
  /** Denormalised from the column so the Jira issue key can be unique per board in the database. */
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ name: 'column_id', type: 'uuid' })
  columnId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deadline: Date | null;

  /** Key of the linked Jira issue; unique within the board when set. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  jiraIssueKey: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  /** User id (auth module); deliberately not a foreign key across modules. */
  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @ManyToOne('BoardColumnEntity', (column: BoardColumnEntity) => column.cards, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'column_id' })
  column?: BoardColumnEntity;

  @ManyToMany('LabelEntity', (label: LabelEntity) => label.cards, { onDelete: 'CASCADE' })
  @JoinTable({
    name: 'card_labels',
    joinColumn: { name: 'card_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'label_id', referencedColumnName: 'id' },
  })
  labels: LabelEntity[];

  @OneToMany('CommentEntity', (comment: CommentEntity) => comment.card)
  comments: CommentEntity[];

  /**
   * Moves the card to a column of the same board at the given position.
   * Neighbouring positions are the caller's responsibility (done transactionally by the service).
   */
  moveTo(target: { id: string; boardId: string }, position: number): void {
    if (target.boardId !== this.boardId) {
      throw new CrossBoardMoveError();
    }
    if (!Number.isInteger(position) || position < 0) {
      throw new InvalidPositionError();
    }
    this.columnId = target.id;
    this.position = position;
  }
}
