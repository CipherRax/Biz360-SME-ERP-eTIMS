import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Sales & invoicing (e2e)', () => {
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

  async function org(label: string, role: string) {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: 'Sales Org' })
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
    return { orgId: reg.body.data.organizationId, admin: accessToken, token: memberLogin.body.data.accessToken };
  }

  async function setupCustomerAndItem(admin: string, token: string) {
    const party = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', name: 'Sarina Traders', taxId: 'P000000000C', paymentTermsDays: 7 })
      .expect(201);

    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: 'Furnished Oak Table', sku: `OAK-${counter}`, sellPrice: '10000.00', taxCode: '1' })
      .expect(201);

    return { partyId: party.body.data.id, itemId: item.body.data.id };
  }

  it('creates a draft invoice with computed VAT totals (stock untouched)', async () => {
    const o = await org('sales-act', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        partyId,
        lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }],
      })
      .expect(201);
    const data = draft.body.data as {
      id: string;
      invoiceNumber: string;
      status: string;
      subtotal: string;
      taxTotal: string;
      total: string;
    };
    expect(data.status).toBe('DRAFT');
    expect(data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    // 2 × 10000 = 20000, tax 16% = 3200, total 23200.
    expect(Number(data.subtotal)).toBe(20000);
    expect(Number(data.taxTotal)).toBe(3200);
    expect(Number(data.total)).toBe(23200);

    // Stock is unchanged while DRAFT.
    const item = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(item.body.data.stockOnHand)).toBe(0);

    await http()
      .get(`/api/v1/invoices/${data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
  });

  it('fails to confirm when stock is insufficient', async () => {
    const o = await org('sales-low', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '5' }] })
      .expect(201);

    const res = await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);
    expect(res.body.message).toContain('Insufficient stock');
  });

  it('records a stock adjustment, then confirm decrements and payment completes the flow', async () => {
    const o = await org('sales-full', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    // Top up stock via a manual adjustment (append-only movement).
    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '50', reason: 'Opening balance' })
      .expect(201);

    const movements = await http()
      .get(`/api/v1/items/${itemId}/stock/movements`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect((movements.body.data as Array<{ quantity: string }>)[0].quantity).toBe('50');

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        partyId,
        lines: [
          { itemId, quantity: '3', unitPrice: '10000.00' },
          { itemId, quantity: '2', unitPrice: '10000.00' },
        ],
      })
      .expect(201);

    const confirmed = await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((confirmed.body.data as { status: string }).status).toBe('CONFIRMED');

    // 50 - 5 = 45 remaining.
    const after = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(after.body.data.stockOnHand)).toBe(45);

    // SALE_OUT movement recorded.
    const afterMovements = await http()
      .get(`/api/v1/items/${itemId}/stock/movements`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect((afterMovements.body.data as Array<{ type: string }>).map((m) => m.type)).toEqual(
      expect.arrayContaining(['SALE_OUT', 'ADJUSTMENT']),
    );

    // Partial payment → PARTIALLY_PAID; balance → PAID.
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ invoiceId: draft.body.data.id, amount: '20000.00', method: 'M_PESA', reference: 'MP123' })
      .expect(201);

    const partial = await http()
      .get(`/api/v1/invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(partial.body.data.status).toBe('PARTIALLY_PAID');
    expect(Number(partial.body.data.amountPaid)).toBe(20000);

    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ invoiceId: draft.body.data.id, amount: '38000.00', method: 'CASH' })
      .expect(201);

    const paid = await http()
      .get(`/api/v1/invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('voids a confirmed invoice and restores stock', async () => {
    const o = await org('sales-void', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '10', reason: 'Opening balance' })
      .expect(201);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '4' }] })
      .expect(201);

    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const itemAfterConfirm = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(itemAfterConfirm.body.data.stockOnHand)).toBe(6);

    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/void`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ reason: 'Customer cancelled' })
      .expect(201);

    const voided = await http()
      .get(`/api/v1/invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(voided.body.data.status).toBe('VOID');
    expect(voided.body.data.voidReason).toBe('Customer cancelled');

    const itemAfterVoid = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(itemAfterVoid.body.data.stockOnHand)).toBe(10);
  });

  it('voids a PAID invoice by unwinding the payment', async () => {
    const o = await org('sales-void-paid', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '5', reason: 'Opening balance' })
      .expect(201);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    const invoiceId = draft.body.data.id;
    const total = Number(draft.body.data.total);
    expect(total).toBe(23200);

    await http()
      .post(`/api/v1/invoices/${invoiceId}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ invoiceId, amount: String(total), method: 'BANK_TRANSFER' })
      .expect(201);

    const paid = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(paid.body.data.status).toBe('PAID');

    await http()
      .post(`/api/v1/invoices/${invoiceId}/void`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ reason: 'Paid in error' })
      .expect(201);

    const voided = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(voided.body.data.status).toBe('VOID');
    // The payment record remains (money history) but the invoice can no longer
    // attract more payments.
    expect(Number(voided.body.data.amountPaid)).toBe(total);

    const itemAfterVoid = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(itemAfterVoid.body.data.stockOnHand)).toBe(5);

    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ invoiceId, amount: '100.00', method: 'CASH' })
      .expect(409);
  });

  it('isolates invoices per organization and enforces RBAC', async () => {
    const oA = await org('sales-iso-a', 'ACCOUNTANT');
    const oB = await org('sales-iso-b', 'ACCOUNTANT');
    const oStaff = await org('sales-staff', 'STAFF');

    const { partyId, itemId } = await setupCustomerAndItem(oA.admin, oA.token);
    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${oA.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1' }] })
      .expect(201);

    // Cross-tenant reads and confirms are blocked.
    await http()
      .get(`/api/v1/invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${oB.token}`)
      .expect(404);
    await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${oB.token}`)
      .expect(404);

    // STAFF cannot create invoices.
    const staffCreate = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${oStaff.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1' }] })
      .expect(403);
    expect(staffCreate.body.success).toBe(false);

    // Supplier parties cannot be used as customers.
    const supplier = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${oA.token}`)
      .send({ type: 'SUPPLIER', name: 'Timber Master Ltd', taxId: 'P000000001Z' })
      .expect(201);
    const invalid = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${oA.token}`)
      .send({ partyId: supplier.body.data.id, lines: [{ itemId, quantity: '1' }] })
      .expect(400);
    expect(invalid.body.message).toContain('supplier');
  });

  it('blocks confirmation when stock is below the requested quantity', async () => {
    const o = await org('sales-stock-floor', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '2', reason: 'Opening balance' })
      .expect(201);

    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '3', unitPrice: '100.00' }] })
      .expect(201);

    const blocked = await http()
      .post(`/api/v1/invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);
    expect(blocked.body.message).toContain('Insufficient stock');

    const stillDraft = await http()
      .get(`/api/v1/invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(stillDraft.body.data.status).toBe('DRAFT');
  });

  it('applies a concurrent double payment exactly once', async () => {
    const o = await org('sales-concurrent', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '1', reason: 'Opening balance' })
      .expect(201);

    const invoice = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1', unitPrice: '10000.00' }] })
      .expect(201);
    const invoiceId = invoice.body.data.id;
    await http()
      .post(`/api/v1/invoices/${invoiceId}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const [r1, r2] = await Promise.all([
      http()
        .post('/api/v1/invoices/payments')
        .set('authorization', `Bearer ${o.token}`)
        .set('idempotency-key', `conc-1-${run}`)
        .send({ invoiceId, amount: '23200.00', method: 'BANK_TRANSFER' }),
      http()
        .post('/api/v1/invoices/payments')
        .set('authorization', `Bearer ${o.token}`)
        .set('idempotency-key', `conc-2-${run}`)
        .send({ invoiceId, amount: '23200.00', method: 'CASH' }),
    ]);

    const okCount = [r1, r2].filter((r) => r.status === 201).length;
    const conflictCount = [r1, r2].filter((r) => r.status === 409).length;
    expect(okCount).toBe(1);
    expect(conflictCount).toBe(1);

    const paid = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    // One payment applied — the balance must not be double-booked.
    expect(Number(paid.body.data.amountPaid)).toBe(23200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('applies a concurrent double confirm exactly once', async () => {
    const o = await org('sales-double-confirm', 'ACCOUNTANT');
    const { partyId, itemId } = await setupCustomerAndItem(o.admin, o.token);

    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '1', reason: 'Opening balance' })
      .expect(201);

    const invoice = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1', unitPrice: '10000.00' }] })
      .expect(201);
    const invoiceId = invoice.body.data.id;

    const results = await Promise.all([
      http()
        .post(`/api/v1/invoices/${invoiceId}/confirm`)
        .set('authorization', `Bearer ${o.token}`)
        .set('idempotency-key', `dconf-1-${run}`),
      http()
        .post(`/api/v1/invoices/${invoiceId}/confirm`)
        .set('authorization', `Bearer ${o.token}`)
        .set('idempotency-key', `dconf-2-${run}`),
    ]);

    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(1);

    // Stock decremented exactly once despite two confirm attempts.
    const item = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(item.body.data.stockOnHand)).toBe(0);

    const confirmed = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(confirmed.body.data.status).toBe('CONFIRMED');
  });
});