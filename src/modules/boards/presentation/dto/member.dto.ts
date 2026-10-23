import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn } from 'class-validator';
import { BoardRole } from '../../domain/board-role';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class InviteMemberDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(trim)
  @IsEmail()
  email: string;

  @ApiProperty({ enum: [BoardRole.MEMBER, BoardRole.VIEWER], default: BoardRole.MEMBER })
  @IsIn([BoardRole.MEMBER, BoardRole.VIEWER])
  role: BoardRole;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: BoardRole })
  @IsEnum(BoardRole)
  role: BoardRole;
}
