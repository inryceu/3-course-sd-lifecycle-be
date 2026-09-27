import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto): Promise<TokenPair> {
    const existingUser = await this.usersRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 10);
    const user = this.usersRepository.create({
      email: registerDto.email,
      passwordHash,
      displayName: registerDto.displayName,
      role: UserRole.MEMBER,
    });

    await this.usersRepository.save(user);
    return this.generateTokens(user);
  }

  async login(loginDto: LoginDto): Promise<TokenPair> {
    const user = await this.usersRepository.findOne({
      where: { email: loginDto.email },
      select: ['id', 'email', 'passwordHash', 'displayName', 'role', 'refreshTokenHash'],
    });

    if (!user || !(await user.comparePassword(loginDto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokens(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const user = await this.usersRepository.findOne({
      where: { refreshTokenHash: await bcrypt.hash(refreshToken, 10) },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.generateTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.usersRepository.update(userId, { refreshTokenHash: null });
  }

  async getProfile(userId: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }

  private async generateTokens(user: User): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.refreshSecret'),
      expiresIn: this.configService.get('jwt.refreshExpiresIn'),
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.usersRepository.update(user.id, { refreshTokenHash });

    return { accessToken, refreshToken };
  }
}