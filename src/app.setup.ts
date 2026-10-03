import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppConfig } from './config/configuration';
import { RealtimeIoAdapter } from './modules/realtime';

/**
 * Applies the HTTP and WebSocket settings shared by the real server (main.ts) and the
 * integration tests, so tests exercise the same prefix, validation and CORS as production.
 * The API version is part of the prefix (`api/v1`), as documented in docs/api/openapi.yaml.
 */
export function configureApp(
  app: INestApplication,
  options: { swagger?: boolean } = {},
): AppConfig {
  const appConfig = app.get(ConfigService).getOrThrow<AppConfig>('app');
  const { apiPrefix, frontendUrl } = appConfig;

  app.setGlobalPrefix(apiPrefix);
  app.enableCors({
    origin: frontendUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, frontendUrl));
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
