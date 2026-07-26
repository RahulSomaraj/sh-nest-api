import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { mongoSanitize, sanitizingQueryParser } from './common/security/mongo-sanitize';

/**
 * Process-level safety net: a truly unhandled rejection or exception leaves Node in an
 * unknown state. Log it and exit non-zero so PM2 replaces the process with a clean one
 * rather than keeping a potentially-corrupt worker serving traffic.
 */
function registerProcessHandlers() {
  process.on('unhandledRejection', (reason: any) => {
    Logger.error(
      `Unhandled promise rejection: ${reason?.stack ?? reason}`,
      undefined,
      'Process',
    );
    process.exit(1);
  });
  process.on('uncaughtException', (err: Error) => {
    Logger.error(`Uncaught exception: ${err?.stack ?? err}`, undefined, 'Process');
    process.exit(1);
  });
}

async function bootstrap() {
  registerProcessHandlers();
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // --- NoSQL operator-injection guard (audit C-2) ---
  // Sanitize parsed query strings at the source (req.query is a re-parsing getter in
  // Express 4, so it must be cleaned in the parser), plus scrub body/params in middleware.
  (app.getHttpAdapter().getInstance() as any).set(
    'query parser',
    sanitizingQueryParser(),
  );
  app.use(mongoSanitize());

  // --- Response compression (audit perf) ---
  // gzip large JSON list payloads. (If you terminate gzip at nginx/the edge, drop this.)
  app.use(compression());

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
  // Allowlist from CORS_ORIGINS (comma-separated).
  // audit (auth hardening): reflecting any origin (origin:true) together with
  // credentials:true lets any website make credentialed requests. In production we
  // therefore REQUIRE an explicit allowlist and fail fast if it's missing. In dev we
  // still reflect the request origin for convenience.
  const corsOrigins = config.get<string[]>('corsOrigins') ?? [];
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && corsOrigins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must be set in production — an explicit allowlist is required ' +
        '(reflecting any origin with credentials is unsafe).',
    );
  }
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true, // dev-only: reflect request origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // NOTE: there is deliberately NO global prefix. The app serves two surfaces with
  // different prefixes — `admin/v2` (sh-account/extranet) and `api` (sh-website) —
  // which are applied per module-group by RouterModule in AppModule. Health probes
  // stay at the root for PM2 / the LB.

  // Run onModuleDestroy / onApplicationShutdown hooks on SIGTERM/SIGINT so a PM2 restart
  // drains in-flight requests and closes the Mongo connection cleanly.
  app.enableShutdownHooks();

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
    .setTitle('StayHopper API')
    .setDescription(
      'Two surfaces: `admin/v2` (sh-account/extranet — Bearer JWT from ' +
        'POST /admin/v2/auth/login) and `api` (sh-website customer — Bearer JWT ' +
        'from POST /api/users/login).',
    )
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
    `sh-api-nest listening on :${port} — surfaces /${config.get<string>(
      'adminPrefix',
    )} and /${config.get<string>('customerPrefix')}, docs at :${port}/docs`,
    'Bootstrap',
  );

  // Tell PM2 the instance is up and listening. With `wait_ready: true` in the ecosystem
  // config, PM2 waits for this before killing the previous instance during a reload,
  // giving zero-downtime restarts. No-op when not run under PM2.
  if (process.send) process.send('ready');
}
bootstrap();
