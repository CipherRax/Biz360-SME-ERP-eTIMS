import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Stock reporting (e2e)', () => {
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
      .send({ name: label, email, password: PASSWORD, organizationName: 'Stock Org' })
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

  it('returns stock summary with correct valuation and lowStock flag', async () => {
    const o = await org('stock-summary', 'ACCOUNTANT');

    // Item A: buyPrice set.
    const itemA = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${o.admin}`)
      .send({ name: 'Item A', sku: `IA-${counter}`, buyPrice: '8000.00', sellPrice: '10000.00', taxCode: '1', reorderLevel: '10' })
      .expect(201);

    // Item B: buyPrice unset.
    const itemB = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${o.admin}`)
      .send({ name: 'Item B', sku: `IB-${counter}`, sellPrice: '5000.00', taxCode: '1', reorderLevel: '5' })
      .expect(201);

    // Adjust stock for item A.
    await http()
      .post(`/api/v1/items/${itemA.body.data.id}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '20', reason: 'Opening balance' })
      .expect(201);

    // Adjust stock for item B.
    await http()
      .post(`/api/v1/items/${itemB.body.data.id}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '3', reason: 'Initial stock' })
      .expect(201);

    const summary = await http()
      .get('/api/v1/inventory/stock/summary')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(summary.body.success).toBe(true);

    const lines: Array<{
      itemId: string;
      stockOnHand: number;
      unitCost: number;
      valuation: number;
      reorderLevel: number;
      lowStock: boolean;
    }> = summary.body.data.items;

    const a = lines.find((l) => l.itemId === itemA.body.data.id)!;
    expect(a).toBeDefined();
    expect(a.stockOnHand).toBe(20);
    expect(a.unitCost).toBe(8000);
    expect(a.valuation).toBe(160000);
    expect(a.reorderLevel).toBe(10);
    expect(a.lowStock).toBe(false); // 20 > 10

    const b = lines.find((l) => l.itemId === itemB.body.data.id)!;
    expect(b).toBeDefined();
    expect(b.stockOnHand).toBe(3);
    expect(b.valuation).toBe(0); // no cost source → 0
    expect(b.lowStock).toBe(true); // 3 ≤ 5

    expect(summary.body.data.totals.items).toBe(2);
    expect(summary.body.data.totals.units).toBe(23);
    expect(summary.body.data.totals.valuation).toBe(160000);
  });

  it('returns movement report with type filter and correct ordering', async () => {
    const o = await org('stock-movements', 'ACCOUNTANT');
    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${o.admin}`)
      .send({ name: 'Widget', sku: `WG-${counter}`, buyPrice: '500.00', sellPrice: '750.00', taxCode: '1' })
      .expect(201);

    await http()
      .post(`/api/v1/items/${item.body.data.id}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '50', reason: 'Restock' })
      .expect(201);

    await http()
      .post(`/api/v1/items/${item.body.data.id}/stock`)
      .set('authorization', `Bearer ${o.admin}`)
      .send({ quantity: '-10', reason: 'Damaged' })
      .expect(201);

    const all = await http()
      .get('/api/v1/inventory/stock/movements')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    const rows = all.body.data as Array<{
      type: string;
      quantity: string;
      createdAt: string;
      item: { id: string; name: string; sku: string };
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Most recent first (createdAt desc).
    expect(new Date(rows[0].createdAt).getTime() >= new Date(rows[1].createdAt).getTime()).toBe(true);
    // Filter by type.
    const adjustments = await http()
      .get('/api/v1/inventory/stock/movements?type=ADJUSTMENT')
      .set('authorization', `Bearer ${o.token}`)
      .expect(200);
    expect(adjustments.body.data.every((m: { type: string }) => m.type === 'ADJUSTMENT')).toBe(true);

    // Verify item is included in movement row.
    expect(rows[0].item.id).toBe(item.body.data.id);
    expect(rows[0].item.name).toBe('Widget');
  });
});