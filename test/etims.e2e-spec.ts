import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('eTIMS submission (e2e)', () => {
  let app: INestApplication;
  const run = Date.now().toString(36);
  let counter = 0;
  const emailFor = (label: string) => `${label}-${run}-${counter++}@erp.test`;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    process.env.OUTBOX_POLL_INTERVAL_MS = '250';
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

  async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for eTIMS submission');
  }

  async function org(label: string, role: string) {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: 'Etims Org' })
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
    const memberEmail = emailFor(`${label}-m`);
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
      admin: accessToken,
      token: memberLogin.body.data.accessToken,
    };
  }

  async function setupCustomerAndItem(admin: string, token: string) {
    const party = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', name: 'Sarina Traders', taxId: 'P000000000C' })
      .expect(201);
    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: 'Furnished Oak Table', sku: `OAK-${counter}`, buyPrice: '8000.00', sellPrice: '10000.00', taxCode: '1' })
      .expect(201);
    return { partyId: party.body.data.id, itemId: item.body.data.id };
  }

  it('submits a confirmed invoice to eTIMS (mock) and reports clean status', async () => {
    const o = await org('etims-submit', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);
    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '10', reason: 'Opening balance' })
      .expect(201);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);

    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    // The outbox worker should submit it asynchronously.
    await waitFor(async () => {
      const res = await http()
        .get(`/api/v1/invoices/${draft.body.data.id}`)
        .set('authorization', `Bearer ${o.token}`)
        .expect(200);
      return res.body.data.etimsSubmittedAt != null;
    });

    const submitted = await http()
      .get(`/api/v1/invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const data = submitted.body.data as {
      etimsCtrlNo: string;
      etimsSubmittedAt: string;
      etimsReceipt: string;
      status: string;
    };
    expect(data.etimsCtrlNo).toMatch(/^MOCK-/);
    expect(new Date(data.etimsSubmittedAt).getTime()).toBeGreaterThan(0);
    expect(JSON.parse(data.etimsReceipt).mock).toBe(true);

    // Compliant: no unsubmitted taxable documents left.
    const status = await http()
      .get('/api/v1/etims/status')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(status.body.data.mode).toBe('mock');
    expect(status.body.data.unsubmittedInvoices).toBe(0);
    expect(status.body.data.deviceSerialConfigured).toBe(false);
    expect(status.body.data.liveReady).toBe(false);
  });

  it('voiding a released invoice enqueues a credit note submission', async () => {
    const o = await org('etims-credit', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '10', reason: 'Opening balance' })
      .expect(201);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);

    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    // Wait for the invoice submission to complete, then void it.
    await waitFor(async () => {
      const res = await http()
        .get(`/api/v1/invoices/${draft.body.data.id}`)
        .set('authorization', `Bearer ${o.token}`)
        .expect(200);
      return res.body.data.etimsSubmittedAt != null;
    });

    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/void`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ reason: 'Customer returned goods' })
      .expect(201);

    await waitFor(async () => {
      const res = await http()
        .get(`/api/v1/invoices/${draft.body.data.id}`)
        .set('authorization', `Bearer ${o.token}`)
        .expect(200);
      return res.body.data.etimsCreditSubmittedAt != null;
    });

    const voided = await http()
      .get(`/api/v1/invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(voided.body.data.status).toBe('VOID');
    expect(voided.body.data.etimsCreditCtrlNo).toMatch(/^MOCK-/);
    expect(voided.body.data.etimsCtrlNo).toMatch(/^MOCK-/);
  });

  it('manual trigger enqueues an invoice and is idempotent afterwards', async () => {
    const o = await org('etims-trigger', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1', unitPrice: '10000.00' }] })
      .expect(201);
    const id = draft.body.data.id;

    const first = await http()
      .post(`/api/v1/etims/sales/${id}/trigger`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((first.body.data as { enqueued: boolean }).enqueued).toBe(true);

    await waitFor(async () => {
      const res = await http()
        .get(`/api/v1/invoices/${id}`)
        .set('authorization', `Bearer ${o.token}`)
        .expect(200);
      return res.body.data.etimsSubmittedAt != null;
    });

    const second = await http()
      .post(`/api/v1/etims/sales/${id}/trigger`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((second.body.data as { alreadySubmitted: boolean }).alreadySubmitted).toBe(true);
    expect((second.body.data as { enqueued: boolean }).enqueued).toBe(false);

    // STAFF cannot trigger submissions.
    const oStaff = await org('etims-staff', 'STAFF');
    await http()
      .post(`/api/v1/etims/sales/${id}/trigger`)
      .set('authorization', `Bearer ${oStaff.token}`)
      .expect(403);
  });
});