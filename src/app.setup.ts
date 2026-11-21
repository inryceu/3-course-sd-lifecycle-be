import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppConfig } from './config/configuration';
import { RealtimeIoAdapter } from './modules/realtime';
import { SanitizingLoggerService } from './common/logger/sanitizing-logger.service';

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
  const { apiPrefix, frontendUrl, trustProxy } = appConfig;

  app.setGlobalPrefix(apiPrefix);
  // Keep the raw bytes for webhook signature verification and allow Jira's larger payloads.
  (app as NestExpressApplication).useBodyParser('json', { limit: '1mb' });
  // Behind nginx req.ip is the proxy; trust its forwarded address so rate limits are per client.
  if (trustProxy > 0) (app as NestExpressApplication).set('trust proxy', trustProxy);
  // Helmet security headers with the default CSP. Only the Swagger UI route drops the CSP.
  const helmetOptions = { frameguard: { action: 'deny' as const } };
  const strict = helmet(helmetOptions);
  const docs = helmet({ ...helmetOptions, contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith(`/${apiPrefix}/docs`) ? docs : strict)(req, res, next),
  );
  app.enableCors({
    origin: frontendUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
  // Sanitizing logger redacts secrets from all log output.
  app.useLogger(app.get(SanitizingLoggerService));
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
