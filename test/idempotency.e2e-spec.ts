import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Idempotency & credit limits (e2e)', () => {
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
      .send({ name: label, email, password: PASSWORD, organizationName: 'Idempotency Org' })
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
      token: login.body.data.accessToken,
      admin: login.body.data.accessToken,
    };
  }

  async function setup(token: string, partyType = 'CUSTOMER', creditLimit?: string) {
    const party = await http()
      .post('/api/v1/parties')
      .set('authorization', `Bearer ${token}`)
      .send({
        type: partyType,
        name: `Idem Party ${counter}`,
        taxId: 'P000000000C',
        ...(creditLimit ? { creditLimit } : {}),
      })
      .expect(201);
    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${token}`)
      .send({
        name: `Idem Item ${counter}`,
        sku: `IDEM-${counter}`,
        buyPrice: '5000.00',
        sellPrice: '10000.00',
        taxCode: '1',
      })
      .expect(201);
    await http()
      .post(`/api/v1/items/${item.body.data.id}/stock`)
      .set('authorization', `Bearer ${token}`)
      .send({ quantity: '10', reason: 'Opening balance' })
      .expect(201);
    return { partyId: party.body.data.id, itemId: item.body.data.id };
  }

  it('idempotent invoice creation and payment do not double-book', async () => {
    const o = await org('idem-sales');
    const { partyId, itemId } = await setup(o.token);
    const key = 'key-invoice-1';

    const draftBody = {
      partyId,
      lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }],
    };
    const first = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', key)
      .send(draftBody)
      .expect(201);
    const invoiceId = first.body.data.id;

    // Same key + same body → replay, not a second invoice.
    const replay = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', key)
      .send(draftBody)
      .expect(201);
    expect(replay.body.data.id).toBe(invoiceId);

    // Same key + different body → rejected.
    await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', key)
      .send({ partyId, lines: [{ itemId, quantity: '3', unitPrice: '10000.00' }] })
      .expect(409);

    // Confirm once; confirming again with the same key must not re-run stock.
    await http()
      .post(`/api/v1/invoices/${invoiceId}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', 'key-confirm-1')
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${invoiceId}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', 'key-confirm-1')
      .expect(201);

    const itemAfter = await http()
      .get(`/api/v1/items/${itemId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(itemAfter.body.data.stockOnHand)).toBe(8);

    // Payment posted once despite two identical calls.
    const payBody = { invoiceId, amount: '23200.00', method: 'CASH' };
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', 'key-pay-1')
      .send(payBody)
      .expect(201);
    await http()
      .post('/api/v1/invoices/payments')
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', 'key-pay-1')
      .send(payBody)
      .expect(201);

    const invoice = await http()
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(Number(invoice.body.data.amountPaid)).toBeCloseTo(23200, 0);
    expect(invoice.body.data.status).toBe('PAID');
  });

  it('enforces the party credit limit on invoice confirmation', async () => {
    const o = await org('idem-credit');
    const { partyId, itemId } = await setup(o.token, 'CUSTOMER', '1000.00');

    // Under the limit → confirm succeeds (580 = 500 + 16% VAT).
    const small = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1', unitPrice: '500.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${small.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(201);

    // A large invoice would push outstanding (580) past the 1000 limit → 409.
    const large = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${large.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(409);

    // The draft stays DRAFT and stock was untouched.
    const draftCheck = await http()
      .get(`/api/v1/invoices/${large.body.data.id}`)
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(draftCheck.body.data.status).toBe('DRAFT');
  });

  it('a failed attempt does not burn the key so it can be retried with a new body', async () => {
    const o = await org('idem-retry');
    const { partyId, itemId } = await setup(o.token, 'CUSTOMER', '1000.00');

    // First attempt with this key fails (credit limit), which must free the key.
    const big = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '2', unitPrice: '10000.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${big.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', 'key-retry-1')
      .expect(409);

    // Same key, different body (a smaller invoice) → must succeed, not conflict.
    const small = await http()
      .post('/api/v1/invoices')
      .set('authorization', `Bearer ${o.token}`)
      .send({ partyId, lines: [{ itemId, quantity: '1', unitPrice: '500.00' }] })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${small.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', 'key-retry-1')
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${small.body.data.id}/confirm`)
      .set('authorization', `Bearer ${o.token}`)
      .set('Idempotency-Key', 'key-retry-1')
      .expect(201);
  });
});