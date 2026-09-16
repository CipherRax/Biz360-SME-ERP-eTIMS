import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { NotificationsService } from './../src/modules/notifications/notifications.service.js';

const PASSWORD = 'E2ePassword123';

describe('Credit Notes, Notifications & Banking (e2e)', () => {
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
      .send({
        name: label,
        email,
        password: PASSWORD,
        organizationName: `${label} Org`,
      })
      .expect(201);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: reg.body.data.devVerificationToken })
      .expect(200);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      orgId: reg.body.data.organizationId,
      token: login.body.data.accessToken,
    };
  }

  async function createCustomer(token: string, name: string, taxId: string) {
    const res = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', name, taxId })
      .expect(201);
    return res.body.data.id;
  }

  async function createItem(
    token: string,
    name: string,
    sku: string,
    sellPrice: string,
  ) {
    const res = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${token}`)
      .send({ name, sku, sellPrice, taxCode: '1' })
      .expect(201);
    return res.body.data.id;
  }

  async function orgWithMember(label: string, role: string) {
    const o = await org(label);
    const memberEmail = emailFor(`${label}-member`);
    await http()
      .post('/api/v1/users')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        name: `${label} Member`,
        email: memberEmail,
        password: PASSWORD,
        role,
      })
      .expect(201);
    const memberLogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: memberEmail, password: PASSWORD })
      .expect(200);
    return {
      orgId: o.orgId,
      admin: o.token,
      token: memberLogin.body.data.accessToken,
    };
  }

  async function stockItem(token: string, itemId: string, quantity: string) {
    await http()
      .post(`/api/v1/items/${itemId}/stock`)
      .set('authorization', `Bearer ${token}`)
      .send({ quantity, reason: 'Opening balance' })
      .expect(201);
  }

  async function createConfirmedInvoice(
    token: string,
    partyId: string,
    itemId: string,
    quantity = '5',
  ) {
    const invoice = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${token}`)
      .send({ partyId, lines: [{ itemId, quantity, unitPrice: '10000.00' }] })
      .expect(201);
    const id = invoice.body.data.id as string;
    await http()
      .post(`/api/v1/invoices/${id}/confirm`)
      .set('authorization', `Bearer ${token}`)
      .expect(201);
    return id;
  }

  async function createCreditNote(
    token: string,
    partyId: string,
    itemId: string,
    referenceInvoiceId?: string,
  ) {
    const res = await http()
      .post('/api/v1/credit-notes')
      .set('authorization', `Bearer ${token}`)
      .send({
        partyId,
        ...(referenceInvoiceId ? { referenceInvoiceId } : {}),
        lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }],
        reason: 'Faulty goods returned',
      })
      .expect(201);
    return res.body.data;
  }

  async function createBankAccount(
    token: string,
    attrs: Record<string, unknown> = {},
  ) {
    const res = await http()
      .post('/api/v1/bank-accounts')
      .set('authorization', `Bearer ${token}`)
      .send({
        name: attrs.name ?? 'Test Bank Account',
        accountType: attrs.accountType ?? 'BANK',
        accountCode: attrs.accountCode ?? `1100-BANK-${run}-${counter++}`,
        bankName: attrs.bankName ?? 'Equity Bank',
        ...attrs,
      })
      .expect(201);
    return res.body.data;
  }

  it('creates and issues a DRAFT credit note referencing an invoice', async () => {
    const o = await org('cn-full');
    const partyId = await createCustomer(
      o.token,
      'CN Full Customer',
      'P000000021C',
    );
    const itemId = await createItem(
      o.token,
      'CN Full Item',
      `CN-FULL-${counter}`,
      '10000.00',
    );
    await stockItem(o.token, itemId, '10');

    const invoiceId = await createConfirmedInvoice(o.token, partyId, itemId);

    const afterConfirm = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(afterConfirm.body.data.stockOnHand)).toBe(5);

    const note = await createCreditNote(o.token, partyId, itemId, invoiceId);
    expect(note.status).toBe('DRAFT');
    expect(note.referenceInvoiceId).toBe(invoiceId);
    expect(note.noteNumber).toMatch(/^CN-\d{4}-\d{6}$/);
    expect(Number(note.total)).toBe(23200);

    const issued = await http()
      .post(`/api/v1/credit-notes/${note.id}/issue`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect(issued.body.data.status).toBe('ISSUED');

    const afterIssue = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(afterIssue.body.data.stockOnHand)).toBe(7);
  });

  it('reduces a referenced invoice amountPaid on credit note issue', async () => {
    const o = await org('cn-paid');
    const partyId = await createCustomer(
      o.token,
      'CN Paid Customer',
      'P000000022C',
    );
    const itemId = await createItem(
      o.token,
      'CN Paid Item',
      `CN-PAID-${counter}`,
      '10000.00',
    );
    await stockItem(o.token, itemId, '10');

    const invoiceId = await createConfirmedInvoice(o.token, partyId, itemId);

    const beforePay = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(beforePay.body.data.total)).toBe(58000);

    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        invoiceId,
        amount: '30000.00',
        method: 'BANK_TRANSFER',
        reference: 'CNPAY-001',
      })
      .expect(201);

    const partial = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(partial.body.data.amountPaid)).toBe(30000);
    expect(partial.body.data.status).toBe('PARTIALLY_PAID');

    const note = await createCreditNote(o.token, partyId, itemId, invoiceId);

    await http()
      .post(`/api/v1/credit-notes/${note.id}/issue`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const after = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(after.body.data.amountPaid)).toBe(6800);
    expect(after.body.data.status).toBe('PARTIALLY_PAID');
  });

  it('rejects issuing a credit note that is not DRAFT', async () => {
    const o = await org('cn-reissue');
    const partyId = await createCustomer(
      o.token,
      'CN Reissue Customer',
      'P000000023C',
    );
    const itemId = await createItem(
      o.token,
      'CN Reissue Item',
      `CN-RE-${counter}`,
      '10000.00',
    );

    const note = await createCreditNote(o.token, partyId, itemId);

    await http()
      .post(`/api/v1/credit-notes/${note.id}/issue`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const rejected = await http()
      .post(`/api/v1/credit-notes/${note.id}/issue`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);
    expect(rejected.body.message).toContain('Cannot issue a credit note');
  });

  it('cancels a DRAFT credit note', async () => {
    const o = await org('cn-cancel');
    const partyId = await createCustomer(
      o.token,
      'CN Cancel Customer',
      'P000000024C',
    );
    const itemId = await createItem(
      o.token,
      'CN Cancel Item',
      `CN-CX-${counter}`,
      '10000.00',
    );

    const note = await createCreditNote(o.token, partyId, itemId);

    const cancelled = await http()
      .post(`/api/v1/credit-notes/${note.id}/cancel`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const fetched = await http()
      .get(`/api/v1/credit-notes/${note.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(fetched.body.data.status).toBe('CANCELLED');

    await http()
      .post(`/api/v1/credit-notes/${note.id}/issue`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);
  });

  it('isolates credit notes per organization', async () => {
    const oA = await org('cn-iso-a');
    const oB = await org('cn-iso-b');

    const partyId = await createCustomer(
      oA.token,
      'CN Iso Customer A',
      'P000000025C',
    );
    const itemId = await createItem(
      oA.token,
      'CN Iso Item',
      `CN-ISO-${counter}`,
      '10000.00',
    );

    const note = await createCreditNote(oA.token, partyId, itemId);

    const missing = await http()
      .get(`/api/v1/credit-notes/${note.id}`)
      .set('authorization', `Bearer ${oB.token}`)
      .expect(404);
    expect(missing.body.success).toBe(false);

    await http()
      .post(`/api/v1/credit-notes/${note.id}/issue`)
      .set('authorization', `Bearer ${oB.token}`)
      .expect(404);

    await http()
      .post(`/api/v1/credit-notes/${note.id}/cancel`)
      .set('authorization', `Bearer ${oB.token}`)
      .expect(404);

    const listB = await http()
      .get('/api/v1/credit-notes')
      .set('authorization', `Bearer ${oB.token}`)
      .expect(200);
    expect(listB.body.data).toEqual([]);
  });

  it('returns empty notifications and zero unread count for a fresh org', async () => {
    const o = await org('notif-empty');

    const list = await http()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(list.body.success).toBe(true);
    expect(list.body.data).toEqual([]);

    const unread = await http()
      .get('/api/v1/notifications/unread-count')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(unread.body.data.count).toBe(0);
  });

  it('marks a notification as read and returns 404 for unknown ids', async () => {
    const o = await org('notif-read');
    const notifications = app.get(NotificationsService);

    const created = await notifications.create(o.orgId, {
      type: 'LOW_STOCK',
      title: 'Low stock: Widgets',
      message: 'Stock on hand is below the reorder level.',
      referenceType: 'Item',
      referenceId: 'item-widgets-001',
    });

    const unread = await http()
      .get('/api/v1/notifications/unread-count')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(unread.body.data.count).toBe(1);

    const list = await http()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].status).toBe('UNREAD');
    expect(list.body.data[0].id).toBe(created.id);

    const read = await http()
      .patch(`/api/v1/notifications/${created.id}/read`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(read.body.data.status).toBe('READ');

    const afterRead = await http()
      .get('/api/v1/notifications/unread-count')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(afterRead.body.data.count).toBe(0);

    const ghost = '00000000-0000-4000-8000-000000000000';
    await http()
      .get(`/api/v1/notifications/${ghost}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(404);
    await http()
      .patch(`/api/v1/notifications/${ghost}/read`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(404);
  });

  it('detects low stock items via the checkLowStock sweep', async () => {
    const o = await org('notif-low');
    const notifications = app.get(NotificationsService);

    const empty = await http()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(empty.body.data).toEqual([]);

    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        name: 'Low Stock Widget',
        sku: `CNLOW-${counter}`,
        sellPrice: '1000.00',
        taxCode: '1',
        reorderLevel: '10',
      })
      .expect(201);
    const itemId = item.body.data.id;

    await stockItem(o.token, itemId, '5');

    const sweep = await notifications.checkLowStock();
    expect(sweep.created).toBeGreaterThanOrEqual(1);

    const list = await http()
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const rows = list.body.data as Array<{
      type: string;
      referenceType: string;
      referenceId: string;
      title: string;
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const low = rows.find(
      (r) => r.referenceType === 'Item' && r.referenceId === itemId,
    );
    expect(low).toBeDefined();
    expect(low!.type).toBe('LOW_STOCK');
    expect(low!.title).toContain('Low stock');
  });

  it('creates a bank account with correct defaults', async () => {
    const o = await org('bank-create');

    const data = await createBankAccount(o.token, {
      name: 'Equity Bank Main',
      accountType: 'BANK',
      accountCode: '1100-EQ',
      bankName: 'Equity Bank',
    });

    expect(data.id).toBeDefined();
    expect(data.name).toBe('Equity Bank Main');
    expect(data.accountType).toBe('BANK');
    expect(data.accountCode).toBe('1100-EQ');
    expect(data.bankName).toBe('Equity Bank');
    expect(data.active).toBe(true);
    expect(data.openingBalance).toBe(0);
    expect(data.currentBalance).toBe(0);
  });

  it('imports bank statement lines', async () => {
    const o = await org('bank-import');
    const account = await createBankAccount(o.token, {
      name: 'Import Account',
      accountCode: '1101-BK',
      bankName: 'KCB',
    });

    const res = await http()
      .post(`/api/v1/bank-accounts/${account.id}/import-statement`)
      .set('authorization', `Bearer ${o.token}`)
      .send({
        lines: [
          {
            transactionDate: '2026-09-01',
            description: 'Cash deposit',
            credit: 50000,
          },
          {
            transactionDate: '2026-09-02',
            description: 'Supplier payment',
            debit: 12000.5,
          },
          {
            transactionDate: '2026-09-03',
            reference: 'MPESA-TX-001',
            credit: 25000,
          },
        ],
      })
      .expect(201);

    expect(res.body.data.imported).toBe(3);
    expect(res.body.data.lines).toHaveLength(3);

    const lines = res.body.data.lines as Array<{
      debit: number;
      credit: number;
      reconciled: boolean;
    }>;
    expect(Number(lines[0].credit)).toBe(50000);
    expect(lines[0].reconciled).toBe(false);
    expect(Number(lines[1].debit)).toBe(12000.5);
    expect(Number(lines[2].credit)).toBe(25000);
  });

  it('lists statement lines', async () => {
    const o = await org('bank-list');
    const account = await createBankAccount(o.token, {
      name: 'List Account',
      accountCode: '1102-BK',
      bankName: 'NCBA',
    });

    await http()
      .post(`/api/v1/bank-accounts/${account.id}/import-statement`)
      .set('authorization', `Bearer ${o.token}`)
      .send({
        lines: [
          {
            transactionDate: '2026-09-01',
            description: 'Deposit',
            credit: 10000,
          },
          {
            transactionDate: '2026-09-05',
            description: 'Withdrawal',
            debit: 3000,
          },
        ],
      })
      .expect(201);

    const res = await http()
      .get(`/api/v1/bank-accounts/${account.id}/statement-lines`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);

    const rows = res.body.data as Array<{
      description: string;
      debit: number;
      credit: number;
      reconciled: boolean;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].reconciled).toBe(false);
    expect(rows[1].reconciled).toBe(false);
    expect(Number(rows[0].credit)).toBe(10000);
    expect(Number(rows[1].debit)).toBe(3000);
  });

  it('reconciles statement lines', async () => {
    const o = await org('bank-recon');
    const account = await createBankAccount(o.token, {
      name: 'Recon Account',
      accountCode: '1103-BK',
      bankName: 'COOP',
    });

    const imported = await http()
      .post(`/api/v1/bank-accounts/${account.id}/import-statement`)
      .set('authorization', `Bearer ${o.token}`)
      .send({
        lines: [
          {
            transactionDate: '2026-09-01',
            description: 'Cash in',
            credit: 50000,
          },
          { transactionDate: '2026-09-05', description: 'Rent', debit: 30000 },
          {
            transactionDate: '2026-09-10',
            description: 'Client payment',
            credit: 45000,
          },
        ],
      })
      .expect(201);

    const allLines = imported.body.data.lines as Array<{ id: string }>;
    const lineIds = allLines.map((l) => l.id);

    const rec = await http()
      .post(`/api/v1/bank-accounts/${account.id}/reconcile`)
      .set('authorization', `Bearer ${o.token}`)
      .send({
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        statementLineIds: [lineIds[0], lineIds[1]],
        notes: 'September bank statement',
      })
      .expect(201);

    expect(rec.body.data.periodStart).toBeDefined();
    expect(rec.body.data.periodEnd).toBeDefined();
    expect(rec.body.data.statementLines).toHaveLength(2);

    const reconciled = await http()
      .get(
        `/api/v1/bank-accounts/${account.id}/statement-lines?reconciled=true`,
      )
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const reconciledIds = (reconciled.body.data as Array<{ id: string }>).map(
      (l) => l.id,
    );
    expect(reconciledIds).toEqual(
      expect.arrayContaining([lineIds[0], lineIds[1]]),
    );
    expect(reconciledIds).toHaveLength(2);

    const unreconciled = await http()
      .get(
        `/api/v1/bank-accounts/${account.id}/statement-lines?reconciled=false`,
      )
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(unreconciled.body.data as Array<{ id: string }>).toHaveLength(1);
    expect((unreconciled.body.data as Array<{ id: string }>)[0].id).toBe(
      lineIds[2],
    );
  });

  it('soft-deletes a bank account', async () => {
    const o = await org('bank-del');
    const account = await createBankAccount(o.token, {
      name: 'Delete Account',
      accountCode: '1104-BK',
      bankName: 'I&M',
    });

    await http()
      .delete(`/api/v1/bank-accounts/${account.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(204);

    await http()
      .get(`/api/v1/bank-accounts/${account.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(404);

    const list = await http()
      .get('/api/v1/bank-accounts')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(
      (list.body.data as Array<{ id: string }>).map((a) => a.id),
    ).not.toContain(account.id);
  });

  it('enforces RBAC so STAFF cannot create bank accounts', async () => {
    const o = await orgWithMember('bank-rbac', 'STAFF');

    const res = await http()
      .post('/api/v1/bank-accounts')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        name: 'Unauthorized Account',
        accountType: 'BANK',
        accountCode: '1109-BK',
        bankName: 'Stanbic',
      })
      .expect(403);

    expect(res.body.success).toBe(false);
  });
});
