import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { BoardsCardsModule } from './modules/boards-cards/boards-cards.module';
import { JiraSyncModule } from './modules/jira-sync/jira-sync.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './health/health.module';
import { validationSchema } from './config/validation.schema';
import { allConfigs } from './config/configuration';

@Module({
  imports: [
    // Configuration with validation schema - fails fast on missing/invalid env vars
    ConfigModule.forRoot({
      isGlobal: true,
      load: allConfigs,
      validationSchema: validationSchema,
      validationOptions: {
        abortEarly: true, // fail fast on first error
      },
      envFilePath: [`.env.${process.env['NODE_ENV'] || 'development'}`, '.env.local', '.env'],
    }),

    // Database - uses typed config namespaces
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.name'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('database.synchronize'),
        logging: configService.get('database.logging'),
        autoLoadEntities: true,
      }),
      inject: [ConfigService],
    }),

    // Feature modules
    AuthModule,
    BoardsCardsModule,
    JiraSyncModule,
    RealtimeModule,
    HealthModule,
  ],
})
export class AppModule {}
