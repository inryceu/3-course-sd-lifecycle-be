import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AUTH_FACADE } from './application/auth-facade.port';
import { AuthFacadeService } from './application/auth-facade.service';
import { AuthService } from './application/auth.service';
import { PasswordHasher } from './application/password-hasher';
import { TokenService } from './application/token.service';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { UserEntity } from './infrastructure/persistence/user.entity';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: { expiresIn: config.getOrThrow<string>('jwt.expiresIn') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasher,
    TokenService,
    JwtStrategy,
    AuthFacadeService,
    { provide: AUTH_FACADE, useExisting: AuthFacadeService },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AUTH_FACADE],
})
export class AuthModule {}
