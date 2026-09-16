import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Workflow: Quotations, Purchase Orders & Goods Receipts (e2e)', () => {
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
    return { orgId: reg.body.data.organizationId, token: login.body.data.accessToken };
  }

  async function createCustomer(token: string, name: string, taxId: string) {
    const res = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', name, taxId })
      .expect(201);
    return res.body.data.id;
  }

  async function createSupplier(token: string, name: string, taxId: string) {
    const res = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'SUPPLIER', name, taxId })
      .expect(201);
    return res.body.data.id;
  }

  async function createItem(token: string, name: string, sku: string, sellPrice: string, buyPrice?: string) {
    const res = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${token}`)
      .send({ name, sku, sellPrice, buyPrice, taxCode: '1' })
      .expect(201);
    return res.body.data.id;
  }

  async function createQuotation(token: string, partyId: string, itemId: string) {
    const res = await http()
      .post('/api/v1/quotations')
      .set('authorization', `Bearer ${token}`)
      .send({
        partyId,
        lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }],
      })
      .expect(201);
    return res.body.data;
  }

  /* ------------------------------ Quotations ------------------------------ */

  it('creates a DRAFT quotation with computed VAT totals', async () => {
    const o = await org('wf-quote-create');
    const partyId = await createCustomer(o.token, 'Sarina Traders', 'P000000000C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `QT-OAK-${counter}`, '10000.00');

    const quote = await createQuotation(o.token, partyId, itemId);
    const data = quote as {
      id: string;
      quoteNumber: string;
      status: string;
      subtotal: string;
      taxTotal: string;
      total: string;
      lines: Array<{
        lineAmount: string;
        lineTotal: string;
        taxAmount: string;
        quantity: string;
        unitPrice: string;
      }>;
    };
    expect(data.status).toBe('DRAFT');
    expect(data.quoteNumber).toMatch(/^QT-\d{4}-\d{6}$/);
    // 2 × 10000 = 20000, tax 16% = 3200, total 23200.
    expect(Number(data.subtotal)).toBe(20000);
    expect(Number(data.taxTotal)).toBe(3200);
    expect(Number(data.total)).toBe(23200);
    expect(data.lines).toHaveLength(1);
    expect(Number(data.lines[0].lineAmount)).toBe(20000);
    expect(Number(data.lines[0].lineTotal)).toBe(20000);
    expect(Number(data.lines[0].taxAmount)).toBe(3200);

    const fetched = await http()
      .get(`/api/v1/quotations/${data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(fetched.body.data.status).toBe('DRAFT');
  });

  it('sends a draft quotation → SENT', async () => {
    const o = await org('wf-quote-send');
    const partyId = await createCustomer(o.token, 'Sarina Traders', 'P000000001C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `QT-SEND-${counter}`, '10000.00');
    const quote = await createQuotation(o.token, partyId, itemId);

    const sent = await http()
      .post(`/api/v1/quotations/${quote.id}/send`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((sent.body.data as { status: string }).status).toBe('SENT');
  });

  it('accepts a sent quotation → ACCEPTED', async () => {
    const o = await org('wf-quote-accept');
    const partyId = await createCustomer(o.token, 'Sarina Traders', 'P000000002C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `QT-ACC-${counter}`, '10000.00');
    const quote = await createQuotation(o.token, partyId, itemId);

    await http()
      .post(`/api/v1/quotations/${quote.id}/send`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const accepted = await http()
      .post(`/api/v1/quotations/${quote.id}/accept`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((accepted.body.data as { status: string }).status).toBe('ACCEPTED');
  });

  it('converts an ACCEPTED quotation into a DRAFT sale invoice', async () => {
    const o = await org('wf-quote-convert');
    const partyId = await createCustomer(o.token, 'Sarina Traders', 'P000000003C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `QT-CONV-${counter}`, '10000.00');
    const quote = await createQuotation(o.token, partyId, itemId);

    await http()
      .post(`/api/v1/quotations/${quote.id}/send`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    await http()
      .post(`/api/v1/quotations/${quote.id}/accept`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const converted = await http()
      .post(`/api/v1/quotations/${quote.id}/convert`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    const invoice = converted.body.data as {
      id: string;
      invoiceNumber: string;
      status: string;
      subtotal: string;
      taxTotal: string;
      total: string;
      lines: Array<{ itemId: string; quantity: string; unitPrice: string }>;
    };
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(Number(invoice.subtotal)).toBe(20000);
    expect(Number(invoice.taxTotal)).toBe(3200);
    expect(Number(invoice.total)).toBe(23200);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0].itemId).toBe(itemId);

    // The quotation is now CONVERTED and points at the new invoice.
    const after = await http()
      .get(`/api/v1/quotations/${quote.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(after.body.data.status).toBe('CONVERTED');
    expect(after.body.data.convertedInvoiceId).toBe(invoice.id);

    // The invoice is readable through the sales module with the same totals.
    const invoiceGet = await http()
      .get(`/api/v1/invoices/${invoice.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(invoiceGet.body.data.status).toBe('DRAFT');
    expect(Number(invoiceGet.body.data.total)).toBe(23200);
  });

  it('cancels a draft quotation → CANCELLED', async () => {
    const o = await org('wf-quote-cancel');
    const partyId = await createCustomer(o.token, 'Sarina Traders', 'P000000004C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `QT-CANCEL-${counter}`, '10000.00');
    const quote = await createQuotation(o.token, partyId, itemId);

    const cancelled = await http()
      .post(`/api/v1/quotations/${quote.id}/cancel`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((cancelled.body.data as { status: string }).status).toBe('CANCELLED');
  });

  it('rejects converting a DRAFT (non-ACCEPTED) quotation', async () => {
    const o = await org('wf-quote-convert-draft');
    const partyId = await createCustomer(o.token, 'Sarina Traders', 'P000000005C');
    const itemId = await createItem(o.token, 'Furnished Oak Table', `QT-BADCONV-${counter}`, '10000.00');
    const quote = await createQuotation(o.token, partyId, itemId);

    const res = await http()
      .post(`/api/v1/quotations/${quote.id}/convert`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);
    expect(res.body.message).toContain('Cannot convert');

    // Still DRAFT and unconverted.
    const after = await http()
      .get(`/api/v1/quotations/${quote.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(after.body.data.status).toBe('DRAFT');
    expect(after.body.data.convertedInvoiceId).toBeNull();
  });

  /* ---------------------------- Purchase orders --------------------------- */

  async function createOrder(token: string, partyId: string, itemId: string) {
    const res = await http()
      .post('/api/v1/purchase-orders')
      .set('authorization', `Bearer ${token}`)
      .send({
        partyId,
        lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }],
      })
      .expect(201);
    return res.body.data;
  }

  it('creates a DRAFT purchase order with computed VAT totals', async () => {
    const o = await org('wf-po-create');
    const partyId = await createSupplier(o.token, 'Timber Master Ltd', 'P000000001Z');
    const itemId = await createItem(o.token, 'Raw Oak Plank', `PO-RAW-${counter}`, '8000.00', '5000.00');

    const po = await createOrder(o.token, partyId, itemId);
    const data = po as {
      id: string;
      poNumber: string;
      status: string;
      subtotal: string;
      taxTotal: string;
      total: string;
      lines: Array<{ lineAmount: string; lineTotal: string; taxAmount: string }>;
    };
    expect(data.status).toBe('DRAFT');
    expect(data.poNumber).toMatch(/^PO-\d{4}-\d{6}$/);
    // 2 × 10000 = 20000, tax 16% = 3200, total 23200.
    expect(Number(data.subtotal)).toBe(20000);
    expect(Number(data.taxTotal)).toBe(3200);
    expect(Number(data.total)).toBe(23200);
    expect(data.lines).toHaveLength(1);
    expect(Number(data.lines[0].lineAmount)).toBe(20000);
    expect(Number(data.lines[0].lineTotal)).toBe(20000);
    expect(Number(data.lines[0].taxAmount)).toBe(3200);
  });

  it('submits a draft PO → SUBMITTED', async () => {
    const o = await org('wf-po-submit');
    const partyId = await createSupplier(o.token, 'Timber Master Ltd', 'P000000002Z');
    const itemId = await createItem(o.token, 'Raw Oak Plank', `PO-SUBMIT-${counter}`, '8000.00', '5000.00');
    const po = await createOrder(o.token, partyId, itemId);

    const submitted = await http()
      .post(`/api/v1/purchase-orders/${po.id}/submit`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((submitted.body.data as { status: string }).status).toBe('SUBMITTED');
  });

  it('approves a submitted PO → APPROVED with approver set', async () => {
    const o = await org('wf-po-approve');
    const partyId = await createSupplier(o.token, 'Timber Master Ltd', 'P000000003Z');
    const itemId = await createItem(o.token, 'Raw Oak Plank', `PO-APPROVE-${counter}`, '8000.00', '5000.00');
    const po = await createOrder(o.token, partyId, itemId);

    await http()
      .post(`/api/v1/purchase-orders/${po.id}/submit`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const approved = await http()
      .post(`/api/v1/purchase-orders/${po.id}/approve`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    const data = approved.body.data as {
      status: string;
      approvedBy: string;
      approvedAt: string | null;
    };
    expect(data.status).toBe('APPROVED');
    expect(data.approvedBy).toBeDefined();
    expect(data.approvedAt).not.toBeNull();
  });

  it('rejects a submitted PO with a reason → REJECTED', async () => {
    const o = await org('wf-po-reject');
    const partyId = await createSupplier(o.token, 'Timber Master Ltd', 'P000000004Z');
    const itemId = await createItem(o.token, 'Raw Oak Plank', `PO-REJECT-${counter}`, '8000.00', '5000.00');
    const po = await createOrder(o.token, partyId, itemId);

    await http()
      .post(`/api/v1/purchase-orders/${po.id}/submit`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const rejected = await http()
      .post(`/api/v1/purchase-orders/${po.id}/reject`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ reason: 'Budget exceeded' })
      .expect(201);
    const data = rejected.body.data as {
      status: string;
      rejectedReason: string;
    };
    expect(data.status).toBe('REJECTED');
    expect(data.rejectedReason).toBe('Budget exceeded');
  });

  it('cancels a draft PO → CANCELLED', async () => {
    const o = await org('wf-po-cancel');
    const partyId = await createSupplier(o.token, 'Timber Master Ltd', 'P000000005Z');
    const itemId = await createItem(o.token, 'Raw Oak Plank', `PO-CANCEL-${counter}`, '8000.00', '5000.00');
    const po = await createOrder(o.token, partyId, itemId);

    const cancelled = await http()
      .post(`/api/v1/purchase-orders/${po.id}/cancel`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((cancelled.body.data as { status: string }).status).toBe('CANCELLED');
  });

  /* ----------------------------- Goods receipts --------------------------- */

  async function approvedPO(token: string, qty = '5') {
    const partyId = await createSupplier(token, 'Timber Master Ltd', 'P000000008Z');
    const itemId = await createItem(token, 'Raw Oak Plank', `GRN-ITEM-${counter}`, '8000.00', '5000.00');
    const po = await http()
      .post('/api/v1/purchase-orders')
      .set('authorization', `Bearer ${token}`)
      .send({ partyId, lines: [{ itemId, quantity: qty, unitPrice: '10000.00' }] })
      .expect(201);
    const poId = po.body.data.id as string;
    const poLineId = po.body.data.lines[0].id as string;
    await http()
      .post(`/api/v1/purchase-orders/${poId}/submit`)
      .set('authorization', `Bearer ${token}`)
      .expect(201);
    await http()
      .post(`/api/v1/purchase-orders/${poId}/approve`)
      .set('authorization', `Bearer ${token}`)
      .expect(201);
    return { poId, poLineId, itemId };
  }

  it('creates and confirms a GRN against an APPROVED PO, increasing stock', async () => {
    const o = await org('wf-grn-confirm');
    const { poId, poLineId, itemId } = await approvedPO(o.token);

    const before = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(before.body.data.stockOnHand)).toBe(0);

    const draft = await http()
      .post('/api/v1/goods-receipts')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        purchaseOrderId: poId,
        notes: 'First delivery',
        lines: [{ poLineId, quantity: '5' }],
      })
      .expect(201);
    expect((draft.body.data as { status: string }).status).toBe('DRAFT');
    expect((draft.body.data as { grnNumber: string }).grnNumber).toMatch(/^GRN-\d{4}-\d{6}$/);

    const confirmed = await http()
      .post(`/api/v1/goods-receipts/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect((confirmed.body.data as { status: string }).status).toBe('CONFIRMED');

    // 0 + 5 stocked in.
    const after = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(after.body.data.stockOnHand)).toBe(5);
  });

  it('updates the PO line receivedQty after the GRN is confirmed', async () => {
    const o = await org('wf-grn-received');
    const { poId, poLineId } = await approvedPO(o.token);

    const draft = await http()
      .post('/api/v1/goods-receipts')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        purchaseOrderId: poId,
        lines: [{ poLineId, quantity: '3' }],
      })
      .expect(201);

    await http()
      .post(`/api/v1/goods-receipts/${draft.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const po = await http()
      .get(`/api/v1/purchase-orders/${poId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(po.body.data.status).toBe('APPROVED');
    expect(Number(po.body.data.lines[0].receivedQty)).toBe(3);
    expect(Number(po.body.data.lines[0].quantity)).toBe(5);
  });

  /* ------------------------- Multi-tenant isolation ------------------------ */

  it('isolates quotations across organizations', async () => {
    const orgA = await org('wf-iso-a');
    const orgB = await org('wf-iso-b');
    const partyId = await createCustomer(orgA.token, 'Sarina Traders', 'P000000009C');
    const itemId = await createItem(orgA.token, 'Furnished Oak Table', `ISO-QT-${counter}`, '10000.00');
    const quote = await createQuotation(orgA.token, partyId, itemId);

    // Org B cannot see org A's quotation...
    const res = await http()
      .get(`/api/v1/quotations/${quote.id}`)
      .set('authorization', `Bearer ${orgB.token}`)
      .expect(404);
    expect(res.body.message).toContain('not found');

    // ...and cannot drive its status transitions either.
    await http()
      .post(`/api/v1/quotations/${quote.id}/send`)
      .set('authorization', `Bearer ${orgB.token}`)
      .expect(404);

    // Org A can still read it as DRAFT.
    const own = await http()
      .get(`/api/v1/quotations/${quote.id}`)
      .set('authorization', `Bearer ${orgA.token}`)
      .expect(200);
    expect(own.body.data.status).toBe('DRAFT');
  });
});