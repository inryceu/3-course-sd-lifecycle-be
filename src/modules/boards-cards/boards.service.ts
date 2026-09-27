import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Board } from './entities/board.entity';
import { BoardMembership } from './entities/board-membership.entity';
import { UserRole } from '../auth/entities/user.entity';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(Board)
    private boardsRepository: Repository<Board>,
    @InjectRepository(BoardMembership)
    private membershipsRepository: Repository<BoardMembership>,
  ) {}

  async create(userId: string, createBoardDto: CreateBoardDto): Promise<Board> {
    const board = this.boardsRepository.create(createBoardDto);
    const savedBoard = await this.boardsRepository.save(board);

    // Add creator as admin
    const membership = this.membershipsRepository.create({
      board: savedBoard,
      user: { id: userId } as any,
      role: UserRole.ADMIN,
    });
    await this.membershipsRepository.save(membership);

    return savedBoard;
  }

  async findAll(userId: string): Promise<Board[]> {
    const memberships = await this.membershipsRepository.find({
      where: { user: { id: userId } },
      relations: ['board'],
    });
    return memberships.map((m) => m.board);
  }

  async findOne(userId: string, boardId: string): Promise<Board> {
    const membership = await this.membershipsRepository.findOne({
      where: { board: { id: boardId }, user: { id: userId } },
      relations: ['board'],
    });

    if (!membership) {
      throw new NotFoundException('Board not found or access denied');
    }

    return membership.board;
  }

  async update(userId: string, boardId: string, updateBoardDto: UpdateBoardDto): Promise<Board> {
    await this.checkPermission(userId, boardId, [UserRole.ADMIN]);
    await this.boardsRepository.update(boardId, updateBoardDto);
    return this.findOne(userId, boardId);
  }

  async remove(userId: string, boardId: string): Promise<void> {
    await this.checkPermission(userId, boardId, [UserRole.ADMIN]);
    await this.boardsRepository.delete(boardId);
  }

  async inviteMember(boardId: string, userId: string, email: string, role: UserRole): Promise<BoardMembership> {
    // This would typically look up user by email
    // For now, assuming userId is provided directly
    const membership = this.membershipsRepository.create({
      board: { id: boardId } as any,
      user: { id: userId } as any,
      role,
    });
    return this.membershipsRepository.save(membership);
  }

  private async checkPermission(userId: string, boardId: string, allowedRoles: UserRole[]): Promise<void> {
    const membership = await this.membershipsRepository.findOne({
      where: { board: { id: boardId }, user: { id: userId } },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}