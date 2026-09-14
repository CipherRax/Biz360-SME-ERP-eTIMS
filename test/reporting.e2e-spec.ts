import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Reporting (e2e)', () => {
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

  async function org(label: string, role: string) {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: 'Reporting Org' })
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

  async function setup(admin: string, token: string) {
    const party = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', name: 'Sarina Traders', taxId: 'P000000000C', paymentTermsDays: 30 })
      .expect(201);
    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: 'Furnished Oak Table', sku: `OAK-${counter}`, buyPrice: '8000.00', sellPrice: '10000.00', taxCode: '1', reorderLevel: '3' })
      .expect(201);
    await http()
      .post(`/api/v1/items/${item.body.data.id}/stock`)
      .set('authorization', `Bearer ${admin}`)
      .send({ quantity: '10', reason: 'Opening balance' })
      .expect(201);
    return { partyId: party.body.data.id, itemId: item.body.data.id };
  }

  it('reports sales summary and receivables lifecycle', async () => {
    const o = await org('rep-summary', 'ACCOUNTANT');
    const { partyId, itemId } = await setup(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    const id = draft.body.data.id;

    await http()
      .post(`/api/v1/invoices/${id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    // Sales summary includes the day's invoice.
    const summary = await http()
      .get('/api/v1/reports/sales/summary')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const s = summary.body.data as {
      days: Array<{ revenue: number; tax: number; invoices: number }>;
      totals: { invoices: number; revenue: number; tax: number };
    };
    expect(s.totals.invoices).toBe(1);
    expect(s.totals.revenue).toBeCloseTo(23200, 0);
    expect(s.totals.tax).toBeCloseTo(3200, 0);

    // Receivables include the unpaid confirmed invoice.
    const recv = await http()
      .get('/api/v1/reports/receivables')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const r = recv.body.data as {
      customers: Array<{ name: string; outstanding: number; openInvoices: number }>;
      totalOutstanding: number;
    };
    expect(r.totalOutstanding).toBeCloseTo(23200, 0);
    expect(r.customers[0].name).toBe('Sarina Traders');
    expect(r.customers[0].openInvoices).toBe(1);

    // Partial payment reduces the balance.
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ invoiceId: id, amount: '10000.00', method: 'M_PESA' })
      .expect(201);
    const partial = await http()
      .get('/api/v1/reports/receivables')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(partial.body.data.totalOutstanding).toBeCloseTo(13200, 0);

    // Full payment clears the receivable.
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ invoiceId: id, amount: '13200.00', method: 'CASH' })
      .expect(201);
    const cleared = await http()
      .get('/api/v1/reports/receivables')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(cleared.body.data.totalOutstanding).toBe(0);
  });

  it('reports top items and dashboard KPIs', async () => {
    const o = await org('rep-dash', 'ACCOUNTANT');
    const { partyId, itemId } = await setup(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const top = await http()
      .get('/api/v1/reports/top-items')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect((top.body.data as Array<{ name: string; qty: number; revenue: number }>)[0]).toMatchObject({
      name: 'Furnished Oak Table',
      qty: 2,
    });

    const dash = await http()
      .get('/api/v1/reports/dashboard')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const d = dash.body.data as {
      salesThisMonth: number;
      invoicesThisMonth: number;
      receivables: number;
      stockValuation: number;
      stockUnits: number;
      lowStockItems: number;
    };
    expect(d.salesThisMonth).toBeCloseTo(23200, 0);
    expect(d.invoicesThisMonth).toBe(1);
    expect(d.receivables).toBeCloseTo(23200, 0);
    // 8 units remaining × 8000 buyPrice.
    expect(d.stockUnits).toBe(8);
    expect(d.stockValuation).toBeCloseTo(64000, 0);
    expect(d.lowStockItems).toBe(0); // 8 > reorder 3
  });
});