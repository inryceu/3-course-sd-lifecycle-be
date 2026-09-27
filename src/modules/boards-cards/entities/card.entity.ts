import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinTable,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { BoardColumn } from './column.entity';
import { Label } from './label.entity';
import { Comment } from './comment.entity';
import { User } from '../../auth/entities/user.entity';

@Entity('cards')
export class Card {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'timestamp', nullable: true })
  deadline: Date | null;

  @Column({ nullable: true, length: 50 })
  jiraIssueKey: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BoardColumn, (column) => column.cards, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'column_id' })
  column: BoardColumn;

  @ManyToMany(() => Label)
  @JoinTable({
    name: 'card_labels',
    joinColumn: { name: 'card_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'label_id', referencedColumnName: 'id' },
  })
  labels: Label[];

  @OneToMany(() => Comment, (comment) => comment.card, { cascade: true })
  comments: Comment[];

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id' })
  assignee: User | null;
}
