import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { correlationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { enrichOpenApiWithExamples } from './common/swagger/examples.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.use(correlationIdMiddleware);

  const config = app.get(ConfigService);
  const nodeEnv = config.getOrThrow<string>('app.nodeEnv');
  const isProduction = nodeEnv === 'production';

  // --- Security headers ---
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? { directives: { defaultSrc: ["'self'"] } }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // --- CORS: fail closed when no origins configured in production ---
  const corsOrigins = config.getOrThrow<string[]>('app.corsOrigins');
  if (isProduction && corsOrigins.length === 0) {
    app.get(Logger).fatal(
      'CORS_ORIGINS is empty in production — refusing to start with wildcard CORS. ' +
        'Set CORS_ORIGINS to a comma-separated list of trusted frontend origins.',
    );
    process.exit(1);
  }
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : isProduction ? [] : '*',
    credentials: corsOrigins.length > 0,
  });

  // --- Body size limits ---
  app.useBodyParser('json', { limit: '1mb' });

  // --- Uploaded assets (e.g. user avatars) ---
  const uploadsRoot = resolve(process.cwd(), 'uploads');
  if (!existsSync(uploadsRoot)) mkdirSync(uploadsRoot, { recursive: true });
  app.useStaticAssets(uploadsRoot, { prefix: '/uploads/', index: false, maxAge: '7d' });

  const prefix = config.getOrThrow<string>('app.apiPrefix');
  app.setGlobalPrefix(prefix);

  // --- Swagger: gated behind NODE_ENV (never exposed in production) ---
  if (!isProduction) {
    const swagger = new DocumentBuilder()
      .setTitle('SME ERP + eTIMS API')
      .setDescription(
        'Multi-tenant SME ERP with Kenya Revenue Authority eTIMS integration',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = enrichOpenApiWithExamples(SwaggerModule.createDocument(app, swagger));
    SwaggerModule.setup(`${prefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // --- Graceful shutdown: ensure in-flight requests / outbox jobs complete ---
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('app.port');
  await app.listen(port);
}

await bootstrap();