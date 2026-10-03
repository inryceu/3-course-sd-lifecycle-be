import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateBoardDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  title: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  jiraProjectKey?: string;
}

export class UpdateBoardDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 50, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  jiraProjectKey?: string | null;
}
