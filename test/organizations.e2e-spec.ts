import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Organizations (e2e)', () => {
  let app: INestApplication;
  const run = Date.now().toString(36);
  let counter = 0;
  const emailFor = (label: string) => `${label}-${run}-${counter++}@erp.test`;

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
    app.setGlobalPrefix(config.getOrThrow<string>('app.apiPrefix'));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function org(label: string) {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: 'Settings Org' })
      .expect(201);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: reg.body.data.devVerificationToken })
      .expect(200);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { token: login.body.data.accessToken };
  }

  it('reads the org profile and defaults settings seeded at registration', async () => {
    const o = await org('org-settings-read');

    const me = await http()
      .get('/api/v1/organizations/me')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(me.body.data.name).toBe('Settings Org');
    expect(me.body.data.settings).toMatchObject({
      taxRate: '16',
      currency: 'KES',
      defaultPaymentTermsDays: 30,
    });

    const settings = await http()
      .get('/api/v1/organizations/settings')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(settings.body.data.invoiceNumberFormat).toContain('INV');
  });

  it('updates org profile and settings (ADMIN), persisted for the tenant', async () => {
    const o = await org('org-settings-update');

    const updated = await http()
      .patch('/api/v1/organizations/settings')
      .set('authorization', `Bearer ${o.token}`)
      .send({ taxRate: '8.00', currency: 'USD', defaultPaymentTermsDays: '45' })
      .expect(200);
    expect(updated.body.data.taxRate).toBe('8');
    expect(updated.body.data.currency).toBe('USD');
    expect(updated.body.data.defaultPaymentTermsDays).toBe(45);

    const me = await http()
      .patch('/api/v1/organizations/me')
      .set('authorization', `Bearer ${o.token}`)
      .send({ name: 'Renamed Org', taxPin: 'A004543210X' })
      .expect(200);
    expect(me.body.data.name).toBe('Renamed Org');
    expect(me.body.data.taxPin).toBe('A004543210X');

    const reRead = await http()
      .get('/api/v1/organizations/me')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(reRead.body.data.name).toBe('Renamed Org');
    expect(reRead.body.data.settings.defaultPaymentTermsDays).toBe(45);
    expect(reRead.body.data.settings.taxRate).toBe('8');
  });

  it('rejects invalid settings and non-ADMIN writers', async () => {
    const o = await org('org-settings-roles');

    await http()
      .patch('/api/v1/organizations/settings')
      .set('authorization', `Bearer ${o.token}`)
      .send({ taxRate: 'not-a-number', currency: 'BTC' })
      .expect(400);

    const member = await http()
      .post('/api/v1/users')
      .set('authorization', `Bearer ${o.token}`)
      .send({ name: 'Staff', email: emailFor('org-staff'), password: PASSWORD, role: 'STAFF' })
      .expect(201);
    const memberLogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: member.body.data.email, password: PASSWORD })
      .expect(200);

    await http()
      .patch('/api/v1/organizations/settings')
      .set('authorization', `Bearer ${memberLogin.body.data.accessToken}`)
      .send({ taxRate: '10.00' })
      .expect(403);

    // STAFF can still read settings.
    await http()
      .get('/api/v1/organizations/settings')
      .set('authorization', `Bearer ${memberLogin.body.data.accessToken}`)
      .expect(200);
  });
});