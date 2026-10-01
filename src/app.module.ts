import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { BoardsCardsModule } from './modules/boards-cards/boards-cards.module';
import { JiraSyncModule } from './modules/jira-sync/jira-sync.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './health/health.module';
import configuration from './config/configuration';
import { AppDataSource } from './config/database-config';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [`.env.${process.env['NODE_ENV'] || 'development'}`, '.env.local', '.env'],
    }),

    // Database - uses shared DataSource configuration (single source of truth for app and CLI)
    TypeOrmModule.forRootAsync({
      useFactory: async () => {
        // Ensure the shared DataSource is initialized with the correct config
        if (!AppDataSource.isInitialized) {
          await AppDataSource.initialize();
        }
        return AppDataSource.options;
      },
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
