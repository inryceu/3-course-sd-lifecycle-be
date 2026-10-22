import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import { BoardRole } from '../domain/board-role';
import { MembersService, MemberView } from '../application/members.service';
import { BoardRoles } from './decorators/board-roles.decorator';
import { BoardAccessGuard } from './guards/board-access.guard';
import { InviteMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

@ApiTags('members')
@ApiBearerAuth()
@Controller('boards/:boardId/members')
@UseGuards(BoardAccessGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @BoardRoles(BoardRole.ADMIN, BoardRole.MEMBER, BoardRole.VIEWER)
  @ApiOperation({ summary: 'List board members' })
  list(
    @CurrentUser('id') currentUserId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<MemberView[]> {
    return this.members.list(currentUserId, boardId);
  }

  @Post()
  @BoardRoles(BoardRole.ADMIN)
  @ApiOperation({ summary: 'Invite an existing user to the board' })
  invite(
    @CurrentUser('id') currentUserId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: InviteMemberDto,
  ): Promise<MemberView> {
    return this.members.invite(currentUserId, boardId, dto.email, dto.role);
  }

  @Patch(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @BoardRoles(BoardRole.ADMIN)
  @ApiOperation({ summary: "Change a member's role" })
  updateRole(
    @CurrentUser('id') currentUserId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<void> {
    return this.members.updateRole(currentUserId, boardId, targetUserId, dto.role);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @BoardRoles(BoardRole.ADMIN)
  @ApiOperation({ summary: 'Remove a member from the board' })
  remove(
    @CurrentUser('id') currentUserId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    return this.members.remove(currentUserId, boardId, targetUserId);
  }
}
