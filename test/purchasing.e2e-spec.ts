import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Purchasing & stock-in (e2e)', () => {
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
      .send({ name: label, email, password: PASSWORD, organizationName: 'Purchasing Org' })
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

  async function setupSupplierAndItem(admin: string, token: string) {
    const party = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'SUPPLIER', name: 'Timber Master Ltd', taxId: 'P000000001Z', paymentTermsDays: 14 })
      .expect(201);

    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${admin}`)
      .send({ name: 'Raw Oak Plank', sku: `OAKCR-${counter}`, sellPrice: '8000.00', taxCode: '1' })
      .expect(201);

    return { partyId: party.body.data.id, itemId: item.body.data.id };
  }

  it('creates a draft purchase with computed VAT totals (stock untouched)', async () => {
    const o = await org('purch-act', 'ACCOUNTANT');
    const { partyId, itemId } = await setupSupplierAndItem(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        partyId,
        supplierRef: 'SUP-001',
        lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }],
      })
      .expect(201);
    const data = draft.body.data as {
      id: string;
      invoiceNumber: string;
      supplierRef: string;
      status: string;
      subtotal: string;
      taxTotal: string;
      total: string;
    };
    expect(data.status).toBe('DRAFT');
    expect(data.supplierRef).toBe('SUP-001');
    expect(data.invoiceNumber).toMatch(/^PO-\d{4}-\d{6}$/);
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
  });

  it('confirm increments stock and records a PURCHASE_IN movement; payments complete the payable', async () => {
    const o = await org('purch-full', 'ACCOUNTANT');
    const { partyId, itemId } = await setupSupplierAndItem(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/purchase-invoices')
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
      .post(`/api/v1/purchase-invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((confirmed.body.data as { status: string }).status).toBe('CONFIRMED');
    expect((confirmed.body.data as { dueDate: string | null }).dueDate).not.toBeNull();

    // 0 + 5 = 5 in stock.
    const item = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(item.body.data.stockOnHand)).toBe(5);

    // PURCHASE_IN movement recorded.
    const movements = await http()
      .get(`/api/v1/items/${itemId}/stock/movements`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect((movements.body.data as Array<{ type: string }>).map((m) => m.type)).toContain('PURCHASE_IN');

    // Partial payment → PARTIALLY_PAID; balance → PAID.
    await http()
      .post('/api/v1/purchase-invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ purchaseInvoiceId: draft.body.data.id, amount: '10000.00', method: 'BANK_TRANSFER', reference: 'REF1024' })
      .expect(201);

    const partial = await http()
      .get(`/api/v1/purchase-invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(partial.body.data.status).toBe('PARTIALLY_PAID');
    expect(Number(partial.body.data.amountPaid)).toBe(10000);

    await http()
      .post('/api/v1/purchase-invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ purchaseInvoiceId: draft.body.data.id, amount: '48000.00', method: 'CASH' })
      .expect(201);

    const paid = await http()
      .get(`/api/v1/purchase-invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('voids a confirmed purchase and reverses stock', async () => {
    const o = await org('purch-void', 'ACCOUNTANT');
    const { partyId, itemId } = await setupSupplierAndItem(o.admin, o.token);

    const draft = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '4', unitPrice: '5000.00' }] })
      .expect(201);

    await http()
      .post(`/api/v1/purchase-invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const itemAfterConfirm = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(itemAfterConfirm.body.data.stockOnHand)).toBe(4);

    await http()
      .post(`/api/v1/purchase-invoices/${draft.body.data.id}/void`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ reason: 'Wrong delivery' })
      .expect(201);

    const voided = await http()
      .get(`/api/v1/purchase-invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(voided.body.data.status).toBe('VOID');
    expect(voided.body.data.voidReason).toBe('Wrong delivery');

    const itemAfterVoid = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(itemAfterVoid.body.data.stockOnHand)).toBe(0);
  });

  it('isolates purchases per organization and enforces RBAC', async () => {
    const oA = await org('purch-iso-a', 'ACCOUNTANT');
    const oB = await org('purch-iso-b', 'ACCOUNTANT');
    const oStaff = await org('purch-staff', 'STAFF');

    const { partyId, itemId } = await setupSupplierAndItem(oA.admin, oA.token);
    const draft = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${oA.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1', unitPrice: '1000.00' }] })
      .expect(201);

    // Cross-tenant reads and confirms are blocked.
    await http()
      .get(`/api/v1/purchase-invoices/${draft.body.data.id}`)
      .set('authorization', `Bearer ${oB.token}`)
      .expect(404);
    await http()
      .post(`/api/v1/purchase-invoices/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${oB.token}`)
      .expect(404);

    // STAFF cannot create purchases.
    const staffCreate = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${oStaff.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1', unitPrice: '1000.00' }] })
      .expect(403);
    expect(staffCreate.body.success).toBe(false);

    // Customer parties cannot be used as suppliers.
    const customer = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${oA.token}`)
      .send({ type: 'CUSTOMER', name: 'Sarina Traders', taxId: 'P000000000C' })
      .expect(201);
    const invalid = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${oA.token}`)
      .send({ partyId: customer.body.data.id, lines: [{ itemId, quantity: '1', unitPrice: '1000.00' }] })
      .expect(400);
    expect(invalid.body.message).toContain('customer');
  });
});