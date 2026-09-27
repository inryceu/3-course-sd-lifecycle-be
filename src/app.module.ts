import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { BoardsCardsModule } from './modules/boards-cards/boards-cards.module';
import { JiraSyncModule } from './modules/jira-sync/jira-sync.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './health/health.module';
import configuration from './config/configuration';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [`.env.${process.env['NODE_ENV'] || 'development'}`, '.env.local', '.env'],
    }),

    // Database
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
