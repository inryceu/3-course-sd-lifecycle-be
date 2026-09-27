import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Board } from './board.entity';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/entities/user.entity';

@Entity('board_memberships')
@Unique(['board', 'user'])
export class BoardMembership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.MEMBER,
  })
  role: UserRole;

  @CreateDateColumn()
  invitedAt: Date;

  @ManyToOne(() => Board, (board) => board.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board: Board;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}