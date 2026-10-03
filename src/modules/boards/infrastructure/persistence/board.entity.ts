import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import type { BoardColumnEntity } from './column.entity';
import type { BoardMembershipEntity } from './board-membership.entity';
import type { LabelEntity } from './label.entity';

@Entity('boards')
export class BoardEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  jiraProjectKey: string | null;

  @OneToMany('BoardColumnEntity', (column: BoardColumnEntity) => column.board)
  columns: BoardColumnEntity[];

  @OneToMany('BoardMembershipEntity', (membership: BoardMembershipEntity) => membership.board)
  memberships: BoardMembershipEntity[];

  @OneToMany('LabelEntity', (label: LabelEntity) => label.board)
  labels: LabelEntity[];
}
