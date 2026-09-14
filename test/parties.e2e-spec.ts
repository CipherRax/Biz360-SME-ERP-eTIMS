import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Parties (e2e)', () => {
  let app: INestApplication;
  const run = Date.now().toString(36);
  let counter = 0;
  const emailFor = (label: string) => `${label}-${run}-${counter++}@erp.test`;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function org(label: string, role?: string) {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: 'Parties Org' })
      .expect(201);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: reg.body.data.devVerificationToken })
      .expect(200);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const accessToken = login.body.data.accessToken;
    if (!role) {
      return { orgId: reg.body.data.organizationId, accessToken };
    }
    const memberEmail = emailFor(`${label}-member`);
    await http()
      .post('/api/v1/users')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ name: `${label} member`, email: memberEmail, password: PASSWORD, role })
      .expect(201);
    const memberLogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: memberEmail, password: PASSWORD })
      .expect(200);
    return {
      orgId: reg.body.data.organizationId,
      accessToken,
      memberToken: memberLogin.body.data.accessToken,
    };
  }

  it('creates, searches, updates and reads back parties', async () => {
    const orgA = await org('pty');

    const created = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .send({
        type: 'CUSTOMER',
        name: 'Karura General Store',
        email: 'karura@example.com',
        phone: '+254712345678',
        taxId: 'A012345678Z',
        city: 'Nairobi',
        creditLimit: '50000.00',
        paymentTermsDays: 14,
      })
      .expect(201);
    const data = created.body.data as {
      id: string;
      type: string;
      taxId: string;
      name: string;
      creditLimit: string;
    };
    expect(data.type).toBe('CUSTOMER');
    expect(data.taxId).toBe('A012345678Z');

    const list = await http()
      .get('/api/v1/parties?search=karura&type=CUSTOMER')
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .expect(200);
    expect((list.body.data as Array<{ id: string }>).map((p) => p.id)).toContain(data.id);

    const fetched = await http()
      .get(`/api/v1/parties/${data.id}`)
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .expect(200);
    expect(fetched.body.data.email).toBe('karura@example.com');

    const updated = await http()
      .patch(`/api/v1/parties/${data.id}`)
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .send({ phone: '+254701112233', status: 'INACTIVE' })
      .expect(200);
    expect(updated.body.data.phone).toBe('+254701112233');
    expect(updated.body.data.status).toBe('INACTIVE');
  });

  it('rejects duplicate KRA PINs within an org but allows them across orgs', async () => {
    const orgA = await org('pin-a');
    const orgB = await org('pin-b');
    const pin = `P${run.slice(-8).toUpperCase()}${counter}`.slice(0, 11);

    await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .send({ type: 'SUPPLIER', name: 'ACME Supplies', taxId: pin })
      .expect(201);

    const dup = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .send({ type: 'SUPPLIER', name: 'Other Supplies', taxId: pin.toLowerCase() })
      .expect(409);
    expect(dup.body.message).toContain('KRA PIN');

    // The same PIN is fine in another organization.
    await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${orgB.accessToken}`)
      .send({ type: 'SUPPLIER', name: 'Other Org Supply', taxId: pin })
      .expect(201);
  });

  it('enforces role gates on party mutations', async () => {
    const orgS = await org('pty-rbac', 'STAFF');

    // STAFF can read...
    await http()
      .get('/api/v1/parties')
      .set('authorization', `Bearer ${orgS.memberToken}`)
      .expect(200);

    // ...but cannot mutate.
    const forbidden = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${orgS.memberToken}`)
      .send({ type: 'CUSTOMER', name: 'Staff Party' })
      .expect(403);
    expect(forbidden.body.success).toBe(false);
  });

  it('isolates and soft-deletes parties per organization', async () => {
    const orgA = await org('pty-del-a');
    const orgB = await org('pty-del-b');

    const created = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .send({ type: 'CUSTOMER', name: 'Org A Only Customer' })
      .expect(201);

    // Cross-tenant access is blocked.
    await http()
      .get(`/api/v1/parties/${created.body.data.id}`)
      .set('authorization', `Bearer ${orgB.accessToken}`)
      .expect(404);

    // Soft delete: disappears from reads.
    await http()
      .delete(`/api/v1/parties/${created.body.data.id}`)
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .expect(204);
    await http()
      .get(`/api/v1/parties/${created.body.data.id}`)
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .expect(404);

    const list = await http()
      .get('/api/v1/parties')
      .set('authorization', `Bearer ${orgA.accessToken}`)
      .expect(200);
    expect((list.body.data as Array<{ id: string }>).map((p) => p.id)).not.toContain(
      created.body.data.id,
    );
  });
});