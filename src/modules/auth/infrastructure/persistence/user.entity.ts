import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

@Entity('users')
export class UserEntity extends BaseEntity {
  /** Stored lower-cased and trimmed; unique. */
  @Column({ type: 'varchar', unique: true })
  email: string;

  /** bcrypt hash. Never selected by default, never serialised. */
  @Column({ type: 'varchar', select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100 })
  displayName: string;
}
