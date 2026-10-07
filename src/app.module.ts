import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventBusModule } from './common/events';
import { allConfigs, DatabaseConfig } from './config/configuration';
import { dataSourceOptions } from './config/database-config';
import { envFilePaths } from './config/env-files';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './modules/auth';
import { BoardsModule } from './modules/boards';
import { HealthModule } from './modules/health';
import { JiraSyncModule } from './modules/jira-sync';
import { RealtimeModule } from './modules/realtime';

@Module({
  imports: [
    // Validated, typed configuration. The app refuses to start on missing or invalid variables.
    ConfigModule.forRoot({
      isGlobal: true,
      load: allConfigs,
      validationSchema,
      validationOptions: { abortEarly: false },
      envFilePath: envFilePaths(),
    }),

    // One DataSource definition (src/config/database-config.ts) shared with the TypeORM CLI.
    // Connection values come from the validated configuration; entities are registered by the
    // modules that own them (autoLoadEntities + TypeOrmModule.forFeature), and migrations are
    // run by the migration runner, never by the app.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const database = config.getOrThrow<DatabaseConfig>('database');
        return {
          ...dataSourceOptions,
          host: database.host,
          port: database.port,
          username: database.username,
          password: database.password,
          database: database.name,
          logging: database.logging,
          entities: [],
          migrations: [],
          autoLoadEntities: true,
          synchronize: false,
        };
      },
    }),

    EventBusModule,
    AuthModule,
    BoardsModule,
    JiraSyncModule,
    RealtimeModule,
    HealthModule,
  ],
})
export class AppModule {}
