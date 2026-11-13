import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppConfig, RealtimeConfig } from './config/configuration';
import {
  ORIGIN_SOCKET_HEADER,
  originSocketMiddleware,
  RealtimeIoAdapter,
} from './modules/realtime';

/**
 * Applies the HTTP and WebSocket settings shared by the real server (main.ts) and the
 * integration tests, so tests exercise the same prefix, validation and CORS as production.
 * The API version is part of the prefix (`api/v1`), as documented in docs/api/openapi.yaml.
 */
export function configureApp(
  app: INestApplication,
  options: { swagger?: boolean } = {},
): AppConfig {
  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');
  const { apiPrefix, frontendUrl } = appConfig;

  app.setGlobalPrefix(apiPrefix);
  // Keep the raw bytes for webhook signature verification and allow Jira's larger payloads.
  (app as NestExpressApplication).useBodyParser('json', { limit: '1mb' });
  // After the body parser, which would drop the request's async context.
  app.use(originSocketMiddleware);
  app.enableCors({
    origin: frontendUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', ORIGIN_SOCKET_HEADER],
    credentials: true,
  });
  app.useWebSocketAdapter(
    new RealtimeIoAdapter(app, frontendUrl, config.getOrThrow<RealtimeConfig>('realtime')),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (options.swagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('BoardSync API')
      .setDescription('Generated from the code. The contract is docs/api/openapi.yaml.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      `${apiPrefix}/docs`,
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
      { swaggerOptions: { persistAuthorization: true } },
    );
  }
  return appConfig;
}
