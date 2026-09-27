import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Board } from '@modules/boards-cards/entities/board.entity';
import { Card } from '@modules/boards-cards/entities/card.entity';
import { User } from '@modules/auth/entities/user.entity';

@Entity('jira_issue_mappings')
@Unique(['board', 'jiraIssueKey'])
export class JiraIssueMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  jiraIssueKey: string;

  @Column({ length: 50 })
  jiraIssueId: string;

  @Column({ length: 100 })
  jiraProjectKey: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Board, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board: Board;

  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id' })
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  card: Card | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;
}
