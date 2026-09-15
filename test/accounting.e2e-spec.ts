import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const PASSWORD = 'E2ePassword123';

describe('Accounting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    prisma = app.get(PrismaService);

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

  async function org(label: string, role = 'ACCOUNTANT') {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: 'Accounting Org' })
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

  async function accounts(token: string) {
    const res = await http()
      .get('/api/v1/accounting/accounts')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const byCode = new Map<string, { id: string; code: string; type: string }>();
    for (const a of res.body.data as Array<{ id: string; code: string; type: string }>) {
      byCode.set(a.code, a);
    }
    return byCode;
  }

  async function setupStock(o: { admin: string; token: string }, itemName: string) {
    const party = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${o.token}`)
      .send({ type: 'BOTH', name: `${itemName} Party`, taxId: 'P000000000C', paymentTermsDays: 30 })
      .expect(201);
    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${o.admin}`)
      .send({
        name: itemName,
        sku: `ACC-${counter}`,
        buyPrice: '10000.00',
        sellPrice: '10000.00',
        taxCode: '1',
        reorderLevel: '3',
      })
      .expect(201);
    await http()
      .post(`/api/v1/items/${item.body.data.id}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '10', reason: 'Opening balance' })
      .expect(201);
    return { partyId: party.body.data.id, itemId: item.body.data.id };
  }

  async function trialBalance(token: string) {
    const res = await http()
      .get('/api/v1/accounting/trial-balance')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data as {
      balanced: boolean;
      totalDebit: number;
      totalCredit: number;
      accounts: Array<{ code: string; debit: number; credit: number; balance: number }>;
    };
  }

  it('seeds a standard chart of accounts and manages accounts', async () => {
    const o = await org('acc-chart');

    const byCode = await accounts(o.token);
    for (const code of ['1000', '1100', '1200', '1300', '1400', '2000', '2100', '2200', '3000', '3100', '4000', '4100', '5000', '5100', '5200']) {
      expect(byCode.has(code)).toBe(true);
    }

    const created = await http()
      .post('/api/v1/accounting/accounts')
      .set('authorization', `Bearer ${o.token}`)
      .send({ code: '6000', name: 'Service Revenue', type: 'INCOME', parentId: byCode.get('4000')!.id })
      .expect(201);
    expect(created.body.data.code).toBe('6000');

    await http()
      .post('/api/v1/accounting/accounts')
      .set('authorization', `Bearer ${o.token}`)
      .send({ code: '6000', name: 'Dup', type: 'INCOME' })
      .expect(409);

    const detail = await http()
      .get(`/api/v1/accounting/accounts/${created.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(detail.body.data.parentId).toBe(byCode.get('4000')!.id);
    expect(detail.body.data.balance).toBe(0);

    // Deleting an account with no activity works.
    const deleted = await http()
      .delete(`/api/v1/accounting/accounts/${created.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(deleted.body.data.deletedAt).toBeTruthy();
  });

  it('rejects unbalanced manual entries and enforces double-entry at the DB', async () => {
    const o = await org('acc-db');
    const byCode = await accounts(o.token);
    const ar = byCode.get('1200')!.id;
    const revenue = byCode.get('4100')!.id;

    // Unbalanced entry (service-level) → 400.
    await http()
      .post('/api/v1/accounting/journal-entries')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        description: 'Torn',
        lines: [
          { accountId: ar, debit: 100 },
          { accountId: revenue, credit: 90 },
        ],
      })
      .expect(400);

    // Line with both sides (service-level) → 400.
    await http()
      .post('/api/v1/accounting/journal-entries')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        description: 'Both sides',
        lines: [
          { accountId: ar, debit: 100 },
          { accountId: revenue, credit: 90, debit: 10 },
        ],
      })
      .expect(400);

    // Balanced entry → DRAFT.
    const created = await http()
      .post('/api/v1/accounting/journal-entries')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        description: 'Balanced manual entry',
        lines: [
          { accountId: ar, debit: 500 },
          { accountId: revenue, credit: 500 },
        ],
      })
      .expect(201);
    const entry = created.body.data;
    expect(entry.status).toBe('DRAFT');
    expect(entry.entryNumber).toMatch(/^JE-\d{4}-\d{6}$/);
    expect(entry.lines).toHaveLength(2);

    // Approve → POSTED.
    await http()
      .post(`/api/v1/accounting/journal-entries/${entry.id}/approve`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);
    const approved = await http()
      .get(`/api/v1/accounting/journal-entries/${entry.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(approved.body.data.status).toBe('POSTED');
    expect(approved.body.data.approvedAt).toBeTruthy();

    // Approving twice → 409.
    await http()
      .post(`/api/v1/accounting/journal-entries/${entry.id}/approve`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);

    // DB trigger: forcing a single line out of balance must be rejected at the
    // database level (row XOR stays valid; the entry-balance check fires).
    const debitLine = approved.body.data.lines.find(
      (l: { debit: string }) => Number(l.debit) > 0,
    )!;
    const creditLine = approved.body.data.lines.find(
      (l: { credit: string }) => Number(l.credit) > 0,
    )!;
    await expect(
      prisma.client.$executeRaw(Prisma.sql`
        UPDATE journal_entry_lines SET "debit" = "debit" + 1 WHERE "id" = ${debitLine.id}
      `),
    ).rejects.toThrow(/must be balanced/);

    // A line with both sides is rejected by the row-level XOR trigger.
    await expect(
      prisma.client.$executeRaw(Prisma.sql`
        UPDATE journal_entry_lines SET "debit" = "credit" WHERE "id" = ${creditLine.id}
      `),
    ).rejects.toThrow(/exactly one of debit or credit/);

    // A register-wide trial balance must always balance after a posted entry.
    const tb = await trialBalance(o.token);
    expect(tb.balanced).toBe(true);
  });

  it('reverses posted entries (original → REVERSED, mirror entry POSTED)', async () => {
    const o = await org('acc-rev');
    const byCode = await accounts(o.token);

    const created = await http()
      .post('/api/v1/accounting/journal-entries')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        description: 'To reverse',
        lines: [
          { accountId: byCode.get('1100')!.id, debit: 750 },
          { accountId: byCode.get('3100')!.id, credit: 750 },
        ],
      })
      .expect(201);
    await http()
      .post(`/api/v1/accounting/journal-entries/${created.body.data.id}/approve`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const reversal = await http()
      .post(`/api/v1/accounting/journal-entries/${created.body.data.id}/reverse`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ reason: 'Correction' })
      .expect(201);
    const rev = reversal.body.data;
    expect(rev.status).toBe('POSTED');
    expect(rev.sourceType).toBe('REVERSAL');
    expect(rev.reversalOfId).toBe(created.body.data.id);
    expect(rev.description).toContain('Correction');

    const original = await http()
      .get(`/api/v1/accounting/journal-entries/${created.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(original.body.data.status).toBe('REVERSED');

    // Reversing an already-reversed entry → 409.
    await http()
      .post(`/api/v1/accounting/journal-entries/${created.body.data.id}/reverse`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);

    // Net effect is zero: posting the original and its reversal balance out.
    const tb = await trialBalance(o.token);
    expect(tb.balanced).toBe(true);
  });

  it('auto-posts sale confirm, payments and voids into the ledger', async () => {
    const o = await org('acc-sales');
    const { partyId, itemId } = await setupStock(o, 'Ledger Desk');

    // Confirm a sale: DR AR 23200 / CR Revenue 20000 / CR VAT 3200.
    const draft = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    const invoiceId = draft.body.data.id;
    await http()
      .post(`/api/v1/invoices/${invoiceId}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const tb1 = await trialBalance(o.token);
    expect(tb1.balanced).toBe(true);
    const arBalance = tb1.accounts.find((a) => a.code === '1200')!.balance;
    expect(arBalance).toBeCloseTo(23200, 0);

    const pl1 = await http()
      .get('/api/v1/accounting/profit-loss')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(pl1.body.data.totalIncome).toBeCloseTo(20000, 0);
    expect(pl1.body.data.netIncome).toBeCloseTo(20000, 0);

    // Payment: DR Cash 10000 / CR AR 10000.
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ invoiceId, amount: '10000.00', method: 'M_PESA' })
      .expect(201);

    const tb2 = await trialBalance(o.token);
    expect(tb2.balanced).toBe(true);
    expect(tb2.accounts.find((a) => a.code === '1200')!.balance).toBeCloseTo(13200, 0);
    expect(tb2.accounts.find((a) => a.code === '1100')!.balance).toBeCloseTo(10000, 0);

    // GL shows the auto entries tagged with their sources.
    const gl = await http()
      .get('/api/v1/accounting/general-ledger?limit=100')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const rows = gl.body.data.entries as Array<{
      sourceType: string;
      account: { code: string };
    }>;
    expect(rows.some((r) => r.sourceType === 'SALE_INVOICE' && r.account.code === '1200')).toBe(true);
    expect(rows.some((r) => r.sourceType === 'SALE_PAYMENT' && r.account.code === '1100')).toBe(true);
    expect(rows.some((r) => r.sourceType === 'SALE_PAYMENT')).toBe(true);

    // Balance sheet balances: assets == liabilities + equity + net income.
    const bs = await http()
      .get('/api/v1/accounting/balance-sheet')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(bs.body.data.totalAssets).toBeCloseTo(23200, 0);
    expect(bs.body.data.totalLiabilitiesAndEquity).toBeCloseTo(23200, 0);
    expect(bs.body.data.netIncome).toBeCloseTo(20000, 0);

    // Void the released invoice → SALE_VOID reversal posted, ledger stays balanced.
    await http()
      .post(`/api/v1/invoices/${invoiceId}/void`)
      .set('authorization', `Bearer ${o.token}`)
      .send({ reason: 'Test void' })
      .expect(201);
    const tb3 = await trialBalance(o.token);
    expect(tb3.balanced).toBe(true);
    const gl3 = await http()
      .get('/api/v1/accounting/general-ledger?limit=100')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(
      (gl3.body.data.entries as Array<{ sourceType: string }>).some(
        (r) => r.sourceType === 'SALE_VOID',
      ),
    ).toBe(true);
  });

  it('auto-posts purchase confirm and payments into the ledger', async () => {
    const o = await org('acc-purchase');
    const { partyId, itemId } = await setupStock(o, 'Ledger Chair');

    const draft = await http()
      .post('/api/v1/purchase-invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    const purchaseId = draft.body.data.id;
    await http()
      .post(`/api/v1/purchase-invoices/${purchaseId}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    const tb1 = await trialBalance(o.token);
    expect(tb1.balanced).toBe(true);
    expect(tb1.accounts.find((a) => a.code === '2100')!.balance).toBeCloseTo(23200, 0);
    expect(tb1.accounts.find((a) => a.code === '1200')!.balance).toBe(0);

    await http()
      .post('/api/v1/purchase-invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .send({ purchaseInvoiceId: purchaseId, amount: '23200.00', method: 'BANK_TRANSFER' })
      .expect(201);

    const tb2 = await trialBalance(o.token);
    expect(tb2.balanced).toBe(true);
    // AP cleared, cash decreased.
    expect(tb2.accounts.find((a) => a.code === '2100')!.balance).toBeCloseTo(0, 0);
    expect(tb2.accounts.find((a) => a.code === '1100')!.balance).toBeCloseTo(-23200, 0);

    const gl = await http()
      .get('/api/v1/accounting/general-ledger?limit=100')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const rows = gl.body.data.entries as Array<{ sourceType: string }>;
    expect(rows.some((r) => r.sourceType === 'PURCHASE_INVOICE')).toBe(true);
    expect(rows.some((r) => r.sourceType === 'PURCHASE_PAYMENT')).toBe(true);
  });

  it('enforces role-based access on accounting writes but allows reads', async () => {
    const o = await org('acc-rbac', 'STAFF');
    const byCode = await accounts(o.token);

    await http()
      .post('/api/v1/accounting/journal-entries')
      .set('authorization', `Bearer ${o.token}`)
      .send({
        description: 'Blocked',
        lines: [
          { accountId: byCode.get('1100')!.id, debit: 10 },
          { accountId: byCode.get('3100')!.id, credit: 10 },
        ],
      })
      .expect(403);

    await http()
      .post('/api/v1/accounting/accounts')
      .set('authorization', `Bearer ${o.token}`)
      .send({ code: '7000', name: 'Blocked', type: 'ASSET' })
      .expect(403);

    await http()
      .get('/api/v1/accounting/trial-balance')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
  });
});