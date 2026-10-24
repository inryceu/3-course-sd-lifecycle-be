import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCardDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  title: string;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  labelIds?: string[];
}

export class UpdateCardDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  title?: string;

  @ApiPropertyOptional({ maxLength: 10000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  deadline?: string | null;
}

export class MoveCardDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  columnId: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  position: number;
}

export class AssignCardDto {
  @ApiProperty({ format: 'uuid', nullable: true, description: 'A board member, or null to clear' })
  // null clears the assignee; a missing value fails IsUUID, so the field stays required.
  @ValidateIf((dto: AssignCardDto) => dto.assigneeId !== null)
  @IsUUID()
  assigneeId: string | null;
}
