import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import type { CardEntity } from './card.entity';

@Entity('comments')
@Index('IDX_comments_card', ['cardId', 'createdAt'])
export class CommentEntity extends BaseEntity {
  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  /** User id (auth module); deliberately not a foreign key across modules. */
  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'boolean', default: false })
  syncedToJira: boolean;

  @ManyToOne('CardEntity', (card: CardEntity) => card.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id' })
  card?: CardEntity;

  markSynced(): void {
    this.syncedToJira = true;
  }
}
