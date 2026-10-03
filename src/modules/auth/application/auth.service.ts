import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { AuthUser, normalizeEmail } from '../domain/auth-user';
import { UserEntity } from '../infrastructure/persistence/user.entity';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

const UNIQUE_VIOLATION = '23505';

export function toAuthUser(entity: Pick<UserEntity, 'id' | 'email' | 'displayName'>): AuthUser {
  return { id: entity.id, email: entity.email, displayName: entity.displayName };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.hasher.hash(input.password);
    try {
      const saved = await this.users.save(
        this.users.create({ email, passwordHash, displayName: input.displayName.trim() }),
      );
      return this.result(toAuthUser(saved));
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.users.findOne({
      where: { email: normalizeEmail(input.email) },
      select: ['id', 'email', 'displayName', 'passwordHash'],
    });

    if (!user) {
      await this.hasher.compareAgainstDummy(input.password);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await this.hasher.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.result(toAuthUser(user));
  }

  async getUser(id: string): Promise<AuthUser | null> {
    const user = await this.users.findOne({ where: { id } });
    return user ? toAuthUser(user) : null;
  }

  private result(user: AuthUser): AuthResult {
    return { ...this.tokens.issue(user), user };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code ===
        UNIQUE_VIOLATION
    );
  }
}
