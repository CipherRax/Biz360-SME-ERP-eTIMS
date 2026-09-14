import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './../src/app.module.js';

describe('SME ERP API (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(ConfigService);
    const prefix = config.getOrThrow<string>('app.apiPrefix');

    app.setGlobalPrefix(prefix);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    const swagger = new DocumentBuilder()
      .setTitle('SME ERP + eTIMS API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup(`${prefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds with the API envelope on unknown routes', () => {
    return request(app.getHttpServer())
      .get('/api/v1/nonexistent')
      .expect(404)
      .expect((res) => {
        expect(res.body).toMatchObject({
          success: false,
          data: null,
          errors: [],
        });
        expect(typeof res.body.timestamp).toBe('string');
      });
  });

  it('exposes Swagger UI', () => {
    return request(app.getHttpServer())
      .get('/api/v1/docs')
      .expect(200)
      .expect('content-type', /html/);
  });

  it('serves the Swagger JSON document', () => {
    return request(app.getHttpServer())
      .get('/api/v1/docs-json')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ openapi: '3.0.0' });
        expect(res.body.paths).toMatchObject({
          '/api/v1/auth/register': expect.any(Object),
          '/api/v1/users/me': expect.any(Object),
        });
      });
  });
});