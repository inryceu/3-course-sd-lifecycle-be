import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToMany } from 'typeorm';
import { Card } from './card.entity';

@Entity('labels')
export class Label {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  name: string;

  @Column({ length: 7, default: '#3498db' })
  color: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToMany(() => Card, (card) => card.labels)
  cards: Card[];
}