import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

interface OrgCtx {
  orgId: string;
  adminEmail: string;
  admin: { userId: string; access: string; refresh: string };
  manager: { userId: string; access: string; refresh: string };
  accountant: { access: string; refresh: string };
  staff: { access: string; refresh: string };
  customerId: string;
  sellerId: string;
  mainItemId: string;
}

describe('Full system test (e2e)', () => {
  let app: INestApplication;
  const run = Date.now().toString(36);
  let counter = 0;
  const emailFor = (label: string) => `${label}-${run}-${counter++}@erp.test`;
  const ctx: { sys?: OrgCtx } = {};

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    process.env.ETIMS_MODE = 'mock';
    process.env.OUTBOX_POLL_INTERVAL_MS = '250';
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

  async function login(email: string, password = PASSWORD) {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data as {
      accessToken: string;
      refreshToken: string;
      refreshTokenId: string;
    };
  }

  it('public health probes respond (liveness, db, redis)', async () => {
    for (const path of ['/api/v1/health', '/api/v1/health/db', '/api/v1/health/redis']) {
      const res = await http().get(path).expect(200);
      expect(res.body.data.status).toBe('ok');
    }
  });

  it('onboards an admin: register → verify → login (bad then good) → me → sessions', async () => {
    const email = emailFor('sys-admin');
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Sys Admin', email, password: PASSWORD, organizationName: 'Sys Org' })
      .expect(201);
    expect(reg.body.data.requiresEmailVerification).toBe(true);
    expect(reg.body.data.devVerificationToken).toBeTruthy();

    // Login before email verification is rejected.
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);

    const verify = await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: reg.body.data.devVerificationToken })
      .expect(200);
    expect(verify.body.data.message).toContain('verified');

    // Wrong password is rejected after verification.
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword1' })
      .expect(401);

    const session = await login(email);
    const me = await http()
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(me.body.data.email).toBe(email);
    expect(me.body.data.role).toBe('ADMIN');

    const sessions = await http()
      .get('/api/v1/auth/sessions')
      .set('authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect((sessions.body.data as Array<{ id: string }>).length).toBeGreaterThanOrEqual(1);

    ctx.sys = {
      orgId: reg.body.data.organizationId,
      adminEmail: email,
      admin: {
        userId: reg.body.data.userId,
        access: session.accessToken,
        refresh: session.refreshToken,
      },
      manager: { userId: '', access: '', refresh: '' },
      accountant: { access: '', refresh: '' },
      staff: { access: '', refresh: '' },
      customerId: '',
      sellerId: '',
      mainItemId: '',
    };
  });

  it('provisions members and manages users end-to-end', async () => {
    const sys = ctx.sys!;

    const make = async (label: string, role: string) => {
      const email = emailFor(label);
      const res = await http()
        .post('/api/v1/users')
        .set('authorization', `Bearer ${sys.admin.access}`)
        .send({ name: label, email, password: PASSWORD, role })
        .expect(201);
      const tokens = await login(email);
      return { userId: res.body.data.id as string, email, tokens };
    };

    const manager = await make('mgr', 'MANAGER');
    const accountant = await make('acc', 'ACCOUNTANT');
    const staff = await make('staff', 'STAFF');

    // List, me, and detail views (MANAGER can read the list).
    const list = await http()
      .get('/api/v1/users')
      .set('authorization', `Bearer ${manager.tokens.accessToken}`)
      .expect(200);
    const emails = (list.body.data as Array<{ email: string }>).map((u) => u.email);
    expect(emails).toEqual(expect.arrayContaining([expect.stringContaining('mgr-'), expect.stringContaining('acc-')]));

    const me = await http()
      .get('/api/v1/users/me')
      .set('authorization', `Bearer ${manager.tokens.accessToken}`)
      .expect(200);
    expect(me.body.data.role).toBe('MANAGER');

    const detail = await http()
      .get(`/api/v1/users/${manager.userId}`)
      .set('authorization', `Bearer ${manager.tokens.accessToken}`)
      .expect(200);
    expect(detail.body.data.id).toBe(manager.userId);

    // Self profile update (name).
    const updated = await http()
      .patch('/api/v1/users/me')
      .set('authorization', `Bearer ${manager.tokens.accessToken}`)
      .send({ name: 'Mgr Renamed' })
      .expect(200);
    expect(updated.body.data.name).toBe('Mgr Renamed');

    // Admin promotes then demotes; role claim requires re-login.
    await http()
      .patch(`/api/v1/users/${accountant.userId}`)
      .set('authorization', `Bearer ${sys.admin.access}`)
      .send({ role: 'MANAGER' })
      .expect(200);
    await http()
      .patch(`/api/v1/users/${accountant.userId}`)
      .set('authorization', `Bearer ${sys.admin.access}`)
      .send({ role: 'ACCOUNTANT' })
      .expect(200);
    const accTokens = await login(accountant.email);

    // Soft-delete a member: gone from list, login fails.
    const doomed = await make('doomed', 'STAFF');
    await http()
      .delete(`/api/v1/users/${doomed.userId}`)
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(204);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: doomed.email, password: PASSWORD })
      .expect(401);

    sys.manager = { userId: manager.userId, access: manager.tokens.accessToken, refresh: manager.tokens.refreshToken };
    sys.accountant = { access: accTokens.accessToken, refresh: accTokens.refreshToken };
    sys.staff = { access: staff.tokens.accessToken, refresh: staff.tokens.refreshToken };
  });

  it('manages API keys (create, list, revoke)', async () => {
    const sys = ctx.sys!;
    const created = await http()
      .post('/api/v1/api-keys')
      .set('authorization', `Bearer ${sys.admin.access}`)
      .send({ name: 'etims-integration', scopes: ['etims:invoice'], expiresInDays: 30 })
      .expect(201);
    expect(created.body.data.name).toBe('etims-integration');
    expect(created.body.data.scopes).toEqual(['etims:invoice']);

    const list = await http()
      .get('/api/v1/api-keys')
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(200);
    expect((list.body.data as Array<{ id: string }>).map((k) => k.id)).toContain(created.body.data.id);

    await http()
      .delete(`/api/v1/api-keys/${created.body.data.id}`)
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(204);

    // Revocation is soft: the key stays listed but is stamped revokedAt.
    const after = await http()
      .get('/api/v1/api-keys')
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(200);
    const revoked = (after.body.data as Array<{ id: string; revokedAt: string | null }>).find(
      (k) => k.id === created.body.data.id,
    );
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it('manages reference data: item categories and units of measure', async () => {
    const sys = ctx.sys!;
    const cat = await http()
      .post('/api/v1/items/categories')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .send({ name: 'Beverages', description: 'Drinks' })
      .expect(201);

    await http()
      .post('/api/v1/items/categories')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .send({ name: 'Beverages' })
      .expect(409);

    const cats = await http()
      .get('/api/v1/items/categories')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(200);
    expect((cats.body.data as Array<{ id: string }>).map((c) => c.id)).toContain(cat.body.data.id);

    const unit = await http()
      .post('/api/v1/items/units')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .send({ name: 'Gram', symbol: 'g' })
      .expect(201);

    const units = await http()
      .get('/api/v1/items/units')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(200);
    expect((units.body.data as Array<{ symbol: string }>).map((u) => u.symbol)).toContain('g');

    await http()
      .delete(`/api/v1/items/units/${unit.body.data.id}`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(204);
    await http()
      .delete(`/api/v1/items/categories/${cat.body.data.id}`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(204);
  });

  it('manages items: create, search, update, stock adjust, delete', async () => {
    const sys = ctx.sys!;
    const sku = `COF-${counter}`;
    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .send({
        name: 'Kikwetu Kenyan Coffee 500g',
        sku,
        buyPrice: '820.00',
        sellPrice: '1150.50',
        taxCode: '1',
        reorderLevel: '10',
        baseUnit: 'pcs',
      })
      .expect(201);
    sys.mainItemId = item.body.data.id;
    expect(Number(item.body.data.sellPrice)).toBe(1150.5);

    const search = await http()
      .get('/api/v1/items?search=coffee')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(200);
    expect((search.body.data as Array<{ id: string }>).map((i) => i.id)).toContain(sys.mainItemId);

    const detail = await http()
      .get(`/api/v1/items/${sys.mainItemId}`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(200);
    expect(detail.body.data.sku).toBe(sku);

    const updated = await http()
      .patch(`/api/v1/items/${sys.mainItemId}`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .send({ sellPrice: '1250.00', description: 'Single origin AA beans' })
      .expect(200);
    expect(Number(updated.body.data.sellPrice)).toBe(1250);

    // A second item is created only to be deleted (soft).
    const doomed = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .send({ name: 'Doomed Item', sku: `DDM-${counter}`, sellPrice: '100.00', taxCode: '1' })
      .expect(201);
    await http()
      .delete(`/api/v1/items/${doomed.body.data.id}`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(204);
    await http()
      .get(`/api/v1/items/${doomed.body.data.id}`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(404);
  });

  it('top-up stock and reads the movement ledger', async () => {
    const sys = ctx.sys!;
    await http()
      .post(`/api/v1/items/${sys.mainItemId}/stock`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .send({ quantity: '30', reason: 'Opening balance' })
      .expect(201);

    const movements = await http()
      .get(`/api/v1/items/${sys.mainItemId}/stock/movements`)
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(200);
    expect((movements.body.data as Array<{ type: string; quantity: string }>)[0]).toMatchObject({
      type: 'ADJUSTMENT',
      quantity: '30',
    });

    const summary = await http()
      .get('/api/v1/inventory/stock/summary')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(200);
    expect(
      (summary.body.data.items as Array<{ itemId: string }>).map((i) => i.itemId),
    ).toContain(sys.mainItemId);

    const report = await http()
      .get('/api/v1/inventory/stock/movements')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(200);
    expect((report.body.data as Array<{ type: string }>).map((m) => m.type)).toContain('ADJUSTMENT');
  });

  it('manages parties: create customer/supplier, list/filter, update, delete', async () => {
    const sys = ctx.sys!;
    const customer = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ type: 'CUSTOMER', name: 'Sarina Traders', taxId: 'P000000000C', paymentTermsDays: 30 })
      .expect(201);
    const supplier = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ type: 'SUPPLIER', name: 'Timber Master Ltd', taxId: 'P000000001Z', paymentTermsDays: 14 })
      .expect(201);

    const customers = await http()
      .get('/api/v1/parties?type=CUSTOMER')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect((customers.body.data as Array<{ id: string }>).map((p) => p.id)).toContain(customer.body.data.id);

    const detail = await http()
      .get(`/api/v1/parties/${customer.body.data.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(detail.body.data.name).toBe('Sarina Traders');

    const patched = await http()
      .patch(`/api/v1/parties/${customer.body.data.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ email: 'sarina@example.com', phone: '+254700000000' })
      .expect(200);
    expect(patched.body.data.email).toBe('sarina@example.com');

    // A THIRD party is created only to be deleted (ADMIN/MANAGER only).
    const doomed = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${sys.admin.access}`)
      .send({ type: 'BOTH', name: 'Temporary Both Trader', taxId: 'P000000002L' })
      .expect(201);
    await http()
      .delete(`/api/v1/parties/${doomed.body.data.id}`)
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(204);
    await http()
      .get(`/api/v1/parties/${doomed.body.data.id}`)
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(404);

    sys.customerId = customer.body.data.id;
    sys.sellerId = supplier.body.data.id;
  });

  it('runs a full sales cycle: draft → patch → confirm → payments → paid', async () => {
    const sys = ctx.sys!;
    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ partyId: sys.customerId, lines: [{ itemId: sys.mainItemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    const d = draft.body.data as { id: string; invoiceNumber: string; status: string; subtotal: string; taxTotal: string; total: string };
    expect(d.status).toBe('DRAFT');
    expect(d.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(Number(d.subtotal)).toBe(20000);
    expect(Number(d.taxTotal)).toBe(3200);
    expect(Number(d.total)).toBe(23200);

    // Drafts are listable and can be patched (date/notes).
    const list = await http()
      .get('/api/v1/invoices?status=DRAFT')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect((list.body.data as Array<{ id: string }>).map((i) => i.id)).toContain(d.id);
    await http()
      .patch(`/api/v1/invoices/${d.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ notes: 'Urgent delivery' })
      .expect(200);

    // Confirm decrements stock and enqueues the eTIMS submission.
    const confirmed = await http()
      .post(`/api/v1/invoices/${d.id}/confirm`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(201);
    expect(confirmed.body.data.status).toBe('CONFIRMED');

    // Partial payment → PARTIALLY_PAID; remainder → PAID.
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ invoiceId: d.id, amount: '10000.00', method: 'M_PESA', reference: 'MP123' })
      .expect(201);
    const partial = await http()
      .get(`/api/v1/invoices/${d.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(partial.body.data.status).toBe('PARTIALLY_PAID');
    expect(Number(partial.body.data.amountPaid)).toBe(10000);

    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ invoiceId: d.id, amount: '13200.00', method: 'CASH' })
      .expect(201);
    const paid = await http()
      .get(`/api/v1/invoices/${d.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(paid.body.data.status).toBe('PAID');

    // Stock went 30 → 28.
    const item = await http()
      .get(`/api/v1/items/${sys.mainItemId}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(Number(item.body.data.stockOnHand)).toBe(28);
  });

  it('runs a full purchase cycle: draft → patch → confirm → payments → paid', async () => {
    const sys = ctx.sys!;
    const draft = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ partyId: sys.sellerId, supplierRef: 'SUP-001', lines: [{ itemId: sys.mainItemId, quantity: '5', unitPrice: '5000.00' }] })
      .expect(201);
    const d = draft.body.data as { id: string; invoiceNumber: string; status: string; total: string };
    expect(d.status).toBe('DRAFT');
    expect(d.invoiceNumber).toMatch(/^PO-\d{4}-\d{6}$/);
    expect(Number(d.total)).toBe(29000); // 6%... default org tax rate 16% → 25000 * 1.16 = 29000

    await http()
      .patch(`/api/v1/purchase-invoices/${d.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ notes: 'Re-order restock' })
      .expect(200);

    // Confirm increments stock: 28 → 33.
    const confirmed = await http()
      .post(`/api/v1/purchase-invoices/${d.id}/confirm`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(201);
    expect(confirmed.body.data.status).toBe('CONFIRMED');

    const item = await http()
      .get(`/api/v1/items/${sys.mainItemId}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(Number(item.body.data.stockOnHand)).toBe(33);

    const afterMovements = await http()
      .get(`/api/v1/items/${sys.mainItemId}/stock/movements`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect((afterMovements.body.data as Array<{ type: string }>).map((m) => m.type)).toContain('PURCHASE_IN');

    // Partial then full payment.
    await http()
      .post('/api/v1/purchase-invoices/payments')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ purchaseInvoiceId: d.id, amount: '10000.00', method: 'BANK_TRANSFER', reference: 'REF1024' })
      .expect(201);
    const partial = await http()
      .get(`/api/v1/purchase-invoices/${d.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(partial.body.data.status).toBe('PARTIALLY_PAID');
    expect(Number(partial.body.data.amountPaid)).toBe(10000);

    await http()
      .post('/api/v1/purchase-invoices/payments')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ purchaseInvoiceId: d.id, amount: '19000.00', method: 'CASH' })
      .expect(201);
    const paid = await http()
      .get(`/api/v1/purchase-invoices/${d.id}`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('exposes consolidated stock and report views with open balances', async () => {
    const sys = ctx.sys!;

    // Seed a receivable: new confirmed (unpaid) sales invoice for 1 unit.
    const unpaidSale = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ partyId: sys.customerId, lines: [{ itemId: sys.mainItemId, quantity: '1', unitPrice: '10000.00' }] })
      .expect(201);
    const saleId = unpaidSale.body.data.id;
    await http()
      .post(`/api/v1/invoices/${saleId}/confirm`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(201);

    // Seed a payable: confirmed (unpaid) purchase.
    const unpaidPurchase = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .send({ partyId: sys.sellerId, lines: [{ itemId: sys.mainItemId, quantity: '2', unitPrice: '5000.00' }] })
      .expect(201);
    const purchaseId = unpaidPurchase.body.data.id;
    await http()
      .post(`/api/v1/purchase-invoices/${purchaseId}/confirm`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(201);

    // Receivables = 1 × 10000 + 16% = 11600; payables = 2 × 5000 + 16% = 11600.
    const receivables = await http()
      .get('/api/v1/reports/receivables')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(receivables.body.data.totalOutstanding).toBeCloseTo(11600, 0);

    const payables = await http()
      .get('/api/v1/reports/payables')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(payables.body.data.totalOutstanding).toBeCloseTo(11600, 0);

    // Sales summary: 2 invoices (one PAID, one CONFIRMED); revenue 23200 + 11600.
    const summary = await http()
      .get('/api/v1/reports/sales/summary')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(summary.body.data.totals.invoices).toBe(2);
    expect(summary.body.data.totals.revenue).toBeCloseTo(34800, 0);

    // Top items: the only sold item should rank first with 3 units.
    const top = await http()
      .get('/api/v1/reports/top-items')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    const first = (top.body.data as Array<{ name: string; qty: number }>)[0];
    expect(first.name).toBe('Kikwetu Kenyan Coffee 500g');
    expect(first.qty).toBe(3);

    // Dashboard KPIs.
    const dash = await http()
      .get('/api/v1/reports/dashboard')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(dash.body.data.salesThisMonth).toBeCloseTo(34800, 0);
    expect(dash.body.data.receivables).toBeCloseTo(11600, 0);
    expect(dash.body.data.payables).toBeCloseTo(11600, 0);
    expect(dash.body.data.invoicesThisMonth).toBe(2);
  });

  it('eTIMS: status shows mode and a confirmed invoice can be (re-)triggered', async () => {
    const sys = ctx.sys!;
    const status = await http()
      .get('/api/v1/etims/status')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    expect(status.body.data.mode).toBe('mock');
    expect(typeof status.body.data.unsubmittedInvoices).toBe('number');

    const invoices = await http()
      .get('/api/v1/invoices?status=CONFIRMED')
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(200);
    const target = (invoices.body.data as Array<{ id: string; invoiceNumber: string }>)[0];

    // First trigger queues; a second call stays idempotent (already processed by worker or re-enqueued).
    const first = await http()
      .post(`/api/v1/etims/sales/${target.id}/trigger`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(201);
    expect(first.body.data.invoiceNumber).toMatch(/^INV-/);
    const second = await http()
      .post(`/api/v1/etims/sales/${target.id}/trigger`)
      .set('authorization', `Bearer ${sys.accountant.access}`)
      .expect(201);
    expect(typeof second.body.data.alreadySubmitted).toBe('boolean');
  });

  it('enforces RBAC: staff can read but not write; manager keeps item rights', async () => {
    const sys = ctx.sys!;
    const staff = sys.staff.access;
    const manager = sys.manager.access;

    // Reads: allowed for any authenticated member.
    await http().get('/api/v1/items').set('authorization', `Bearer ${staff}`).expect(200);
    await http().get('/api/v1/parties').set('authorization', `Bearer ${staff}`).expect(200);
    await http().get('/api/v1/invoices').set('authorization', `Bearer ${staff}`).expect(200);
    await http().get('/api/v1/reports/dashboard').set('authorization', `Bearer ${staff}`).expect(200);

    // Writes: blocked for STAFF across the write surface.
    await http().post('/api/v1/items').set('authorization', `Bearer ${staff}`).send({ name: 'x', sku: `x${counter}` }).expect(403);
    await http().post('/api/v1/parties').set('authorization', `Bearer ${staff}`).send({ type: 'CUSTOMER', name: 'Nope Ltd' }).expect(403);
    await http().post('/api/v1/invoices').set('authorization', `Bearer ${staff}`).send({ partyId: sys.customerId, lines: [{ itemId: sys.mainItemId, quantity: '1' }] }).expect(403);
    await http().post('/api/v1/users').set('authorization', `Bearer ${staff}`).send({ name: 'Nope', email: emailFor('nope'), password: PASSWORD, role: 'STAFF' }).expect(403);
    await http().post('/api/v1/api-keys').set('authorization', `Bearer ${staff}`).send({ name: 'nope' }).expect(403);

    // MANAGER still has item write rights.
    await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${manager}`)
      .send({ name: 'Manager Item', sku: `MGR-${counter}`, sellPrice: '50.00', taxCode: '1' })
      .expect(201);
  });

  it('password reset: forgot is accepted, weak new passwords rejected, bad tokens rejected', async () => {
    const sys = ctx.sys!;
    await http()
      .post('/api/v1/auth/password/forgot')
      .send({ email: sys.adminEmail })
      .expect(200);
    await http()
      .post('/api/v1/auth/password/reset')
      .send({ token: 'too-short', newPassword: 'NewPassword123' })
      .expect(400);
    await http()
      .post('/api/v1/auth/password/reset')
      .send({ token: '0123456789abcdef', newPassword: 'short' })
      .expect(400);
  });

  it('controls sessions and completes logout: access tokens stay valid, refresh dies', async () => {
    const sys = ctx.sys!;

    // Single-session revocation: a fresh session for the admin, then killed.
    const fresh = await login(sys.adminEmail);
    await http()
      .delete(`/api/v1/auth/sessions/${fresh.refreshTokenId}`)
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(204);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: fresh.refreshToken })
      .expect(401);

    // Admin logout revokes the current refresh token; the (stateless) access token still works.
    const forLogout = await login(sys.adminEmail);
    await http()
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${sys.admin.access}`)
      .send({ refreshToken: forLogout.refreshToken })
      .expect(204);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: forLogout.refreshToken })
      .expect(401);
    await http()
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${sys.admin.access}`)
      .expect(200);

    // Revoke-all for the manager kills their refresh token too.
    await http()
      .delete('/api/v1/auth/sessions')
      .set('authorization', `Bearer ${sys.manager.access}`)
      .expect(204);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sys.manager.refresh })
      .expect(401);
  });
});