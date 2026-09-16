import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { correlationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { enrichOpenApiWithExamples } from './common/swagger/examples.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.use(correlationIdMiddleware);
  app.use(helmet());

  const config = app.get(ConfigService);
  const prefix = config.getOrThrow<string>('app.apiPrefix');

  app.setGlobalPrefix(prefix);
  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigins').length
      ? config.getOrThrow<string[]>('app.corsOrigins')
      : '*',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

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

  const port = config.getOrThrow<number>('app.port');
  await app.listen(port);
}

await bootstrap();