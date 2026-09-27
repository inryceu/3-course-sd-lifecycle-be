import { IsString, IsUUID, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ColumnType } from '../entities/column.entity';

export class CreateColumnDto {
  @ApiProperty({ example: 'Backlog', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ enum: ColumnType, example: ColumnType.TODO })
  @IsEnum(ColumnType)
  type: ColumnType;

  @ApiProperty({ example: 'uuid-of-board' })
  @IsUUID()
  boardId: string;
}
