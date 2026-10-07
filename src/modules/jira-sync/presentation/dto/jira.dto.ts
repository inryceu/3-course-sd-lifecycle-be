import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class BoardQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  boardId: string;
}

export class OAuthCallbackQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(256)
  state: string;

  @ApiPropertyOptional({ description: 'Provider error such as access_denied' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;
}
