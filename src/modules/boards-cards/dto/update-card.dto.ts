import { IsString, IsOptional, IsUUID, IsArray, IsDateString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { CreateCardDto } from './create-card.dto';

export class UpdateCardDto extends PartialType(CreateCardDto) {
  @ApiPropertyOptional({ example: 'uuid-of-column' })
  @IsOptional()
  @IsUUID()
  columnId?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  position?: number;
}