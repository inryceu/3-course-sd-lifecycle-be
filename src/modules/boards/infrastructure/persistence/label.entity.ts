import { Column, Entity, Index, JoinColumn, ManyToMany, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import type { BoardEntity } from './board.entity';
import type { CardEntity } from './card.entity';

@Entity('labels')
@Index('UQ_labels_board_name', ['boardId', 'name'], { unique: true })
export class LabelEntity extends BaseEntity {
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'varchar', length: 7, default: '#3498db' })
  color: string;

  @ManyToOne('BoardEntity', (board: BoardEntity) => board.labels, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board?: BoardEntity;

  @ManyToMany('CardEntity', (card: CardEntity) => card.labels, { onDelete: 'CASCADE' })
  cards?: CardEntity[];
}
