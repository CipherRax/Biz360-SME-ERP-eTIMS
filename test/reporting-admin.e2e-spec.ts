import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Reporting & User Admin (e2e)', () => {
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

  async function org(label: string) {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: `${label} Org` })
      .expect(201);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: reg.body.data.devVerificationToken })
      .expect(200);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { orgId: reg.body.data.organizationId, token: login.body.data.accessToken as string };
  }

  async function createCustomer(token: string, name: string, taxId: string) {
    const res = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', name, taxId })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createSupplier(token: string, name: string, taxId: string) {
    const res = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'SUPPLIER', name, taxId })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createItem(token: string, name: string, sku: string, sellPrice: string, buyPrice?: string) {
    const res = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${token}`)
      .send({ name, sku, sellPrice, buyPrice: buyPrice ?? sellPrice, taxCode: '1' })
      .expect(201);
    return res.body.data.id as string;
  }

  async function stockItem(token: string, itemId: string, quantity: string) {
    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${token}`)
      .send({ quantity, reason: 'Opening balance' })
      .expect(201);
  }

  async function createMember(token: string, name: string, role: string) {
    const email = emailFor(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const res = await http()
      .post('/api/v1/users')
      .set('authorization', `Bearer ${token}`)
      .send({ name: `${name} User`, email, password: PASSWORD, role })
      .expect(201);
    return { email, id: res.body.data.id as string };
  }

  async function login(email: string) {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  it('returns empty aged receivables when there are no outstanding invoices', async () => {
    const o = await org('aged-empty');

    const res = await http()
      .get('/api/v1/reports/receivables/aged')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const d = res.body.data as {
      parties: Array<{ partyId: string; partyName: string; totalOutstanding: number }>;
      totalOutstanding: number;
    };
    expect(d.parties).toHaveLength(0);
    expect(d.totalOutstanding).toBe(0);
  });

  it('groups outstanding receivables by age buckets', async () => {
    const o = await org('aged-recv');
    const customerId = await createCustomer(o.token, 'Sarina Traders', 'A000000001C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `OAK-${counter}`, '10000.00');
    await stockItem(o.token, itemId, '10');

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId: customerId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const res = await http()
      .get('/api/v1/reports/receivables/aged')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const d = res.body.data as {
      parties: Array<{
        partyId: string;
        partyName: string;
        totalOutstanding: number;
        current: number;
        days30: number;
        days60: number;
        over90: number;
      }>;
      totalOutstanding: number;
    };
    const entry = d.parties.find((p) => p.partyName === 'Sarina Traders');
    expect(entry).toBeDefined();
    expect(d.totalOutstanding).toBeCloseTo(23200, 0);
    expect(entry!.totalOutstanding).toBeCloseTo(23200, 0);
    expect(entry!.current).toBeCloseTo(23200, 0);
    expect(entry!.days30).toBe(0);
    expect(entry!.days60).toBe(0);
    expect(entry!.over90).toBe(0);
  });

  it('groups outstanding payables by age buckets', async () => {
    const o = await org('aged-pay');
    const supplierId = await createSupplier(o.token, 'Timber Master Ltd', 'A000000001Z');
    const itemId = await createItem(o.token, 'Raw Oak Plank', `OAKP-${counter}`, '10000.00');

    const draft = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId: supplierId, lines: [{ itemId, quantity: '1', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/purchase-invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const res = await http()
      .get('/api/v1/reports/payables/aged')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const d = res.body.data as {
      parties: Array<{
        partyId: string;
        partyName: string;
        totalOutstanding: number;
        current: number;
        days30: number;
        days60: number;
        over90: number;
      }>;
      totalOutstanding: number;
    };
    const entry = d.parties.find((p) => p.partyName === 'Timber Master Ltd');
    expect(entry).toBeDefined();
    expect(d.totalOutstanding).toBeCloseTo(11600, 0);
    expect(entry!.totalOutstanding).toBeCloseTo(11600, 0);
    expect(entry!.current).toBeCloseTo(11600, 0);
  });

  it('returns VAT summary for a period', async () => {
    const o = await org('tax-summary');
    const customerId = await createCustomer(o.token, 'Sarina Traders', 'A000000002C');
    const supplierId = await createSupplier(o.token, 'Timber Master Ltd', 'A000000002Z');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `OAKT-${counter}`, '10000.00');
    await stockItem(o.token, itemId, '10');

    const salesDraft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId: customerId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${salesDraft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const purchaseDraft = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId: supplierId, lines: [{ itemId, quantity: '1', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/purchase-invoices/${purchaseDraft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const res = await http()
      .get('/api/v1/reports/tax-summary?startDate=2026-01-01&endDate=2026-12-31')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const d = res.body.data as {
      outputVat: number;
      inputVat: number;
      netVat: number;
      salesInvoiceCount: number;
      purchaseInvoiceCount: number;
    };
    expect(d.outputVat).toBeCloseTo(3200, 0);
    expect(d.inputVat).toBeCloseTo(1600, 0);
    expect(d.netVat).toBeCloseTo(1600, 0);
    expect(d.salesInvoiceCount).toBe(1);
    expect(d.purchaseInvoiceCount).toBe(1);
  });

  it('returns dashboard KPIs', async () => {
    const o = await org('dashboard');
    const customerId = await createCustomer(o.token, 'Sarina Traders', 'A000000003C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `OAKD-${counter}`, '10000.00', '8000.00');
    await stockItem(o.token, itemId, '10');

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId: customerId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const res = await http()
      .get('/api/v1/reports/dashboard')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const d = res.body.data as {
      salesToday: number;
      salesThisMonth: number;
      invoicesThisMonth: number;
      receivables: number;
      payables: number;
      stockValuation: number;
      stockUnits: number;
      lowStockItems: number;
      unsubmittedEtimsInvoices: number;
    };
    expect(d.salesToday).toBeCloseTo(23200, 0);
    expect(d.salesThisMonth).toBeCloseTo(23200, 0);
    expect(d.invoicesThisMonth).toBe(1);
    expect(d.receivables).toBeCloseTo(23200, 0);
    expect(d.payables).toBe(0);
    expect(d.stockValuation).toBeCloseTo(64000, 0);
    expect(d.stockUnits).toBe(8);
    expect(d.lowStockItems).toBe(0);
    expect(typeof d.unsubmittedEtimsInvoices).toBe('number');
  });

  it('admin can suspend a user, blocking their login', async () => {
    const o = await org('suspend');
    const member = await createMember(o.token, 'Suspend Staff', 'STAFF');

    const res = await http()
      .patch(`/api/v1/users/${member.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    expect(res.body.data.status).toBe('SUSPENDED');

    const blocked = await http()
      .post('/api/v1/auth/login')
      .send({ email: member.email, password: PASSWORD })
      .expect(403);
    expect(blocked.body.message).toBe('Account is suspended');
  });

  it('admin can reactivate a suspended user', async () => {
    const o = await org('reactivate');
    const member = await createMember(o.token, 'Reactivate Staff', 'STAFF');

    await http()
      .patch(`/api/v1/users/${member.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    const res = await http()
      .patch(`/api/v1/users/${member.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(res.body.data.status).toBe('ACTIVE');

    const accessToken = await login(member.email);
    expect(typeof accessToken).toBe('string');
  });

  it('non-admin manager cannot change another user status', async () => {
    const o = await org('manager-deny');
    const manager = await createMember(o.token, 'Deny Manager', 'MANAGER');
    const staff = await createMember(o.token, 'Deny Staff', 'STAFF');
    const managerToken = await login(manager.email);

    const res = await http()
      .patch(`/api/v1/users/${staff.id}`)
      .set('authorization', `Bearer ${managerToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(403);
    expect(res.body.message).toContain('ADMIN');
  });

  it('staff cannot access admin-only user management', async () => {
    const o = await org('staff-deny');
    const staff = await createMember(o.token, 'No Admin Staff', 'STAFF');
    const accountant = await createMember(o.token, 'No Admin Accountant', 'ACCOUNTANT');
    const staffToken = await login(staff.email);

    await http()
      .patch(`/api/v1/users/${accountant.id}`)
      .set('authorization', `Bearer ${staffToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(403);
  });
});