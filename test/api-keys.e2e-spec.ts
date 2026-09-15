import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('API keys (e2e)', () => {
  let app: INestApplication;
  const run = Date.now().toString(36);

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    process.env.ETIMS_MODE = 'mock';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 1,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(false);

    const config = app.get(ConfigService);
    const prefix = config.getOrThrow<string>('app.apiPrefix');
    app.setGlobalPrefix(prefix);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  let counter = 0;
  const emailFor = (label: string) => `${label}-${run}-${counter++}@erp.test`;

  async function adminToken(): Promise<string> {
    const email = emailFor('apikey-admin');
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Key Admin', email, password: PASSWORD, organizationName: 'Keys Org' })
      .expect(201);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: reg.body.data.devVerificationToken })
      .expect(200);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return login.body.data.accessToken;
  }

  it('admin creates, lists, and revokes an API key', async () => {
    const token = await adminToken();

    const created = await http()
      .post('/api/v1/api-keys')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'etims-integration', scopes: ['etims:invoice'], expiresInDays: 30 })
      .expect(201);
    const data = created.body.data as {
      id: string;
      key: string;
      name: string;
      scopes: string[];
    };
    expect(data.key.startsWith('erp_')).toBe(true);
    expect(data.key.length).toBeGreaterThan(40);
    expect(data.scopes).toEqual(['etims:invoice']);

    // The raw key is never stored — only its hash is.
    expect(created.body.data).not.toHaveProperty('keyHash');

    const list = await http()
      .get('/api/v1/api-keys')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((list.body.data as Array<{ id: string }>).map((k) => k.id)).toContain(data.id);
    expect(list.body.data[0]).not.toHaveProperty('keyHash');

    await http()
      .delete(`/api/v1/api-keys/${data.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);

    const after = await http()
      .get('/api/v1/api-keys')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (after.body.data as Array<{ id: string; revokedAt: string | null }>).find(
        (k) => k.id === data.id,
      )?.revokedAt,
    ).not.toBeNull();
  });

  it('rejects API key management for non-admins', async () => {
    const admin = await adminToken();
    const memberEmail = emailFor('apikey-member');
    await http()
      .post('/api/v1/users')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: 'Member', email: memberEmail, password: PASSWORD, role: 'STAFF' })
      .expect(201);
    const memberLogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: memberEmail, password: PASSWORD })
      .expect(200);

    const res = await http()
      .post('/api/v1/api-keys')
      .set('authorization', `Bearer ${memberLogin.body.data.accessToken}`)
      .send({ name: 'nope' })
      .expect(403);
    expect(res.body.success).toBe(false);
  });

  it('isolates API keys per organization', async () => {
    const tokenA = await adminToken();
    const tokenB = await adminToken();

    const a = await http()
      .post('/api/v1/api-keys')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: 'org-a-key' })
      .expect(201);

    const listB = await http()
      .get('/api/v1/api-keys')
      .set('authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect((listB.body.data as Array<{ id: string }>).map((k) => k.id)).not.toContain(
      a.body.data.id,
    );

    // Org B cannot revoke org A's key.
    await http()
      .delete(`/api/v1/api-keys/${a.body.data.id}`)
      .set('authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('authenticates requests with a Bearer API key (tenant-scoped, read-only)', async () => {
    const token = await adminToken();
    const key = await http()
      .post('/api/v1/api-keys')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'viewer', scopes: ['reports:read'] })
      .expect(201);
    const apiKey = (key.body.data as { key: string }).key;

    // Create a party so the org has read data, then read it with the API key.
    const party = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', name: 'Key Party', taxId: 'P123456789K' })
      .expect(201);

    const read = await http()
      .get('/api/v1/parties')
      .set('authorization', `Bearer ${apiKey}`)
      .expect(200);
    expect((read.body.data as Array<{ id: string }>).map((p) => p.id)).toContain(
      party.body.data.id,
    );

    // API keys are treated as READ_ONLY: writes and privileged endpoints are denied.
    await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${apiKey}`)
      .send({ type: 'SUPPLIER', name: 'Nope', taxId: 'P000000000A' })
      .expect(403);
    await http()
      .get('/api/v1/users')
      .set('authorization', `Bearer ${apiKey}`)
      .expect(403);

    // Invalid / revoked keys are rejected with 401.
    await http()
      .get('/api/v1/parties')
      .set('authorization', `Bearer erp_invalid_made_up_key_value`)
      .expect(401);
    await http()
      .delete(`/api/v1/api-keys/${key.body.data.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    await http()
      .get('/api/v1/parties')
      .set('authorization', `Bearer ${apiKey}`)
      .expect(401);
  });
});