import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const globalPrefix = config.get<string>('globalPrefix');

  // --- Security headers ---
  // crossOriginResourcePolicy relaxed so the SPA can load API-served images/uploads.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Swagger UI needs inline styles/scripts; CSP is left to the edge/CDN.
      contentSecurityPolicy: false,
    }),
  );

  // --- CORS ---
  // Allowlist from CORS_ORIGINS (comma-separated). If empty, reflect the request
  // origin so existing clients keep working while still allowing credentials
  // (a literal "*" origin is incompatible with credentials).
  const corsOrigins = config.get<string[]>('corsOrigins') ?? [];
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // The sh-account frontend calls config.apiUrl = `<host>/admin/v2`
  app.setGlobalPrefix(globalPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // Legacy controllers accept loose payloads; don't hard-fail on extras.
      forbidNonWhitelisted: false,
    }),
  );

  // Consistent error envelope for every unhandled failure.
  app.useGlobalFilters(new AllExceptionsFilter());

  // --- Swagger / OpenAPI ---
  // Auto-discovers every controller/route. Served at /docs (outside the API
  // prefix). Bearer auth is registered globally so the Authorize button and the
  // lock icon apply to all endpoints.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('StayHopper Admin API')
    .setDescription('Admin/v2 API — NestJS. Authorize with a Bearer JWT from POST /admin/v2/auth/login.')
    .setVersion('2.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Require the JWT scheme on every operation by default.
  document.security = [{ JWT: [] }];
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('port');
  await app.listen(port);
  Logger.log(
    `sh-api-nest listening on :${port}/${globalPrefix} — docs at :${port}/docs`,
    'Bootstrap',
  );
}
bootstrap();
