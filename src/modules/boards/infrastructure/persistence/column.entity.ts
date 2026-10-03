import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import { ColumnType } from '../../domain/board-role';
import type { BoardEntity } from './board.entity';
import type { CardEntity } from './card.entity';

@Entity('columns')
@Index('IDX_columns_board_position', ['boardId', 'position'])
export class BoardColumnEntity extends BaseEntity {
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'enum', enum: ColumnType, default: ColumnType.TODO })
  type: ColumnType;

  @Column({ type: 'int', default: 0 })
  position: number;

  @ManyToOne('BoardEntity', (board: BoardEntity) => board.columns, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board: BoardEntity;

  @OneToMany('CardEntity', (card: CardEntity) => card.column)
  cards: CardEntity[];
}
