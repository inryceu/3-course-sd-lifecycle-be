import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

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

export class JiraImportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  boardId: string;

  @ApiPropertyOptional({
    example: 'KAN',
    description: "Links the board to this project; defaults to the board's current jiraProjectKey",
  })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{1,9}$/, { message: 'projectKey must be a Jira project key like KAN' })
  projectKey?: string;
}

export class StatusMappingEntryDto {
  @ApiProperty({ example: '10001' })
  @IsString()
  @MaxLength(50)
  jiraStatusId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  columnId: string;
}

export class PutStatusMappingsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  boardId: string;

  @ApiProperty({ type: [StatusMappingEntryDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StatusMappingEntryDto)
  mappings: StatusMappingEntryDto[];
}
