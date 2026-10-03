import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { QueryFailedError, Repository } from 'typeorm';
import { UserEntity } from '../infrastructure/persistence/user.entity';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

const SECRET = 'unit-test-secret-with-at-least-32-characters';

function setup(options: { rounds?: number; expiresIn?: string } = {}) {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: options.expiresIn ?? '1h' },
  });
  const config = { getOrThrow: () => options.rounds ?? 10 };
  const hasher = new PasswordHasher(config as never);
  const tokens = new TokenService(jwt);

  const rows: UserEntity[] = [];
  const repository = {
    create: jest.fn((input: Partial<UserEntity>) => ({ ...input }) as UserEntity),
    save: jest.fn((user: UserEntity) => {
      if (rows.some((row) => row.email === user.email)) {
        return Promise.reject(
          new QueryFailedError(
            'INSERT',
            [],
            Object.assign(new Error('duplicate'), { code: '23505' }),
          ),
        );
      }
      const saved = { ...user, id: `user-${rows.length + 1}` } as UserEntity;
      rows.push(saved);
      return Promise.resolve(saved);
    }),
    findOne: jest.fn(({ where }: { where: { email?: string; id?: string } }) =>
      Promise.resolve(
        rows.find((row) => (where.email ? row.email === where.email : row.id === where.id)) ?? null,
      ),
    ),
  };
  const service = new AuthService(repository as unknown as Repository<UserEntity>, hasher, tokens);
  return { service, repository, rows, jwt, hasher };
}

const input = { email: 'User@Example.com ', password: 'correct horse', displayName: ' Ann ' };

describe('AuthService', () => {
  describe('register', () => {
    it('stores a normalised e-mail and a bcrypt hash, never the password', async () => {
      const { service, rows } = setup();

      await service.register(input);

      expect(rows[0].email).toBe('user@example.com');
      expect(rows[0].displayName).toBe('Ann');
      expect(rows[0].passwordHash).not.toBe(input.password);
      expect(rows[0].passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(await bcrypt.compare(input.password, rows[0].passwordHash)).toBe(true);
    });

    it('uses the configured bcrypt cost', async () => {
      const { service, rows } = setup({ rounds: 11 });
      await service.register(input);
      expect(rows[0].passwordHash).toMatch(/^\$2[aby]\$11\$/);
    });

    it('returns a token, its lifetime and the user without any password data', async () => {
      const { service } = setup();

      const result = await service.register(input);

      expect(result.user).toEqual({ id: 'user-1', email: 'user@example.com', displayName: 'Ann' });
      expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
      expect(result.expiresIn).toBe(3600);
    });

    it('issues a token whose claims are the user id and e-mail and which lasts at most one hour', async () => {
      const { service, jwt } = setup();

      const { accessToken } = await service.register(input);
      const claims = jwt.verify<{ sub: string; email: string; iat: number; exp: number }>(
        accessToken,
      );

      expect(claims.sub).toBe('user-1');
      expect(claims.email).toBe('user@example.com');
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    });

    it('rejects a duplicate e-mail regardless of letter case', async () => {
      const { service, rows } = setup();
      await service.register(input);

      await expect(
        service.register({ ...input, email: 'USER@example.COM' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(rows).toHaveLength(1);
    });

    it('lets exactly one of two concurrent registrations succeed', async () => {
      const { service, rows } = setup();

      const results = await Promise.allSettled([service.register(input), service.register(input)]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(rows).toHaveLength(1);
    });

    it('does not hide unrelated database errors', async () => {
      const { service, repository } = setup();
      repository.save.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.register(input)).rejects.toThrow('connection lost');
    });
  });

  describe('login', () => {
    it('returns a token for correct credentials, ignoring e-mail case', async () => {
      const { service } = setup();
      await service.register(input);

      const result = await service.login({ email: 'USER@example.com', password: input.password });

      expect(result.user.email).toBe('user@example.com');
      expect(result.accessToken).toEqual(expect.any(String));
    });

    it('rejects a wrong password with a generic message', async () => {
      const { service } = setup();
      await service.register(input);

      const attempt = service.login({ email: 'user@example.com', password: 'wrong password' });

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow('Invalid credentials');
    });

    it('rejects an unknown e-mail with the same message and still spends hashing time', async () => {
      const { service, hasher } = setup();
      const dummy = jest.spyOn(hasher, 'compareAgainstDummy');

      const attempt = service.login({ email: 'nobody@example.com', password: 'whatever1' });

      await expect(attempt).rejects.toThrow('Invalid credentials');
      expect(dummy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUser', () => {
    it('returns null for an unknown id', async () => {
      const { service } = setup();
      expect(await service.getUser('missing')).toBeNull();
    });
  });
});
