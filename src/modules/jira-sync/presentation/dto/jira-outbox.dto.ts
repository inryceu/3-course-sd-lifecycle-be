import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class OutboxBoardQueryDto {
  @IsUUID()
  boardId: string;
}

export class OutboxListQueryDto {
  @IsUUID()
  boardId: string;

  @IsOptional()
  @IsIn(['PENDING', 'IN_PROGRESS', 'SENT', 'DEAD'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
