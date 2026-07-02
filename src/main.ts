import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Mirror the legacy Express CORS (helmet + permissive cross-origin for the SPA)
  app.enableCors();

  // The sh-account frontend calls config.apiUrl = `<host>/admin/v2`
  app.setGlobalPrefix(config.get<string>('globalPrefix'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // Legacy controllers accept loose payloads; don't hard-fail on extras.
      forbidNonWhitelisted: false,
    }),
  );

  const port = config.get<number>('port');
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`sh-api-nest listening on :${port}/${config.get('globalPrefix')}`);
}
bootstrap();
