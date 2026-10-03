import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import { BoardRole, roleCanEdit, roleCanManage } from '../../domain/board-role';
import type { BoardEntity } from './board.entity';

@Entity('board_memberships')
@Index('UQ_board_memberships_board_user', ['boardId', 'userId'], { unique: true })
@Index('IDX_board_memberships_user', ['userId'])
export class BoardMembershipEntity extends BaseEntity {
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  /** User id (auth module); deliberately not a foreign key across modules. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: BoardRole, default: BoardRole.MEMBER })
  role: BoardRole;

  @ManyToOne('BoardEntity', (board: BoardEntity) => board.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board?: BoardEntity;

  /** `createdAt` doubles as the invitation time. */
  get invitedAt(): Date {
    return this.createdAt;
  }

  canEdit(): boolean {
    return roleCanEdit(this.role);
  }

  canManage(): boolean {
    return roleCanManage(this.role);
  }
}
