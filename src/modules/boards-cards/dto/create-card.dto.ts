import { IsString, IsOptional, IsUUID, IsArray, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCardDto {
  @ApiProperty({ example: 'New Task', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'Task description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'uuid-of-column' })
  @IsUUID()
  columnId: string;

  @ApiPropertyOptional({ example: ['uuid-label-1', 'uuid-label-2'] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  labelIds?: string[];

  @ApiPropertyOptional({ example: '2025-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  deadline?: string;
}
