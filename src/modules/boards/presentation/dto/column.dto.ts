import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { ColumnType } from '../../domain/board-role';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateColumnDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  title: string;

  @ApiPropertyOptional({ enum: ColumnType })
  @IsOptional()
  @IsEnum(ColumnType)
  type?: ColumnType;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateColumnDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  title?: string;

  @ApiPropertyOptional({ enum: ColumnType })
  @IsOptional()
  @IsEnum(ColumnType)
  type?: ColumnType;
}

export class ReorderColumnDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  position: number;
}
