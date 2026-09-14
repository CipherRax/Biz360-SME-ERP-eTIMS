import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const PASSWORD = 'E2ePassword123';

describe('Inventory (e2e)', () => {
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

  async function userWithRole(label: string, role?: string) {
    const email = emailFor(label);
    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: label, email, password: PASSWORD, organizationName: 'Inv Org' })
      .expect(201);
    const orgId = reg.body.data.organizationId;
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: reg.body.data.devVerificationToken })
      .expect(200);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const accessToken = login.body.data.accessToken;
    // Re-registering an org admin yields an ADMIN; member provisioning allows
    // exercising non-admin roles inside this org.
    const memberEmail = emailFor(`${label}-member`);
    const created = await http()
      .post('/api/v1/users')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ name: `${label} member`, email: memberEmail, password: PASSWORD, role: role ?? 'STAFF' })
      .expect(201);
    const memberLogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: memberEmail, password: PASSWORD })
      .expect(200);
    return { orgId, accessToken, memberToken: memberLogin.body.data.accessToken, memberId: created.body.data.id };
  }

  it('MANAGER creates, searches, updates and reads back items', async () => {
    const org = await userWithRole('inv-manager', 'MANAGER');

    const item = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({
        name: 'Kikwetu Kenyan Coffee 500g',
        sku: 'COF-KW-500',
        buyPrice: '820.00',
        sellPrice: '1150.50',
        taxCode: '1',
        reorderLevel: '10',
        baseUnit: 'pcs',
      })
      .expect(201);
    const data = item.body.data as {
      id: string;
      name: string;
      sku: string;
      sellPrice: string;
      taxCode: string;
    };
    expect(data.name).toBe('Kikwetu Kenyan Coffee 500g');
    expect(Number(data.sellPrice)).toBe(1150.5);
    expect(data.taxCode).toBe('1');

    const list = await http()
      .get('/api/v1/items?search=coffee')
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(200);
    expect(
      (list.body.data as Array<{ id: string }>).map((i) => i.id),
    ).toContain(data.id);

    const detail = await http()
      .get(`/api/v1/items/${data.id}`)
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(200);
    expect(detail.body.data.sku).toBe('COF-KW-500');

    const updated = await http()
      .patch(`/api/v1/items/${data.id}`)
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({ sellPrice: '1250.00', description: 'Single origin AA beans' })
      .expect(200);
    expect(Number(updated.body.data.sellPrice)).toBe(1250);
    expect(updated.body.data.description).toBe('Single origin AA beans');
  });

  it('rejects duplicate SKUs within an org but allows them across orgs', async () => {
    const orgA = await userWithRole('sku-a', 'MANAGER');
    const orgB = await userWithRole('sku-b', 'MANAGER');

    const sku = `SKU-${counter}`;
    await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${orgA.memberToken}`)
      .send({ name: 'First Item', sku })
      .expect(201);

    const dup = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${orgA.memberToken}`)
      .send({ name: 'Second Item', sku })
      .expect(409);
    expect(dup.body.message).toContain('SKU already exists');

    // The same SKU is fine in a different tenant.
    await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${orgB.memberToken}`)
      .send({ name: 'Other Org Item', sku })
      .expect(201);
  });

  it('enforces role gates on item mutations', async () => {
    const org = await userWithRole('inv-rbac');

    // STAFF can read...
    const list = await http()
      .get('/api/v1/items')
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    // ...but not write.
    const forbidden = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({ name: 'Staff Item' })
      .expect(403);
    expect(forbidden.body.success).toBe(false);
  });

  it('isolates items per organization', async () => {
    const orgA = await userWithRole('iso-a', 'MANAGER');
    const orgB = await userWithRole('iso-b', 'MANAGER');

    const created = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${orgA.memberToken}`)
      .send({ name: 'Org A Only' })
      .expect(201);

    const listB = await http()
      .get('/api/v1/items')
      .set('authorization', `Bearer ${orgB.memberToken}`)
      .expect(200);
    expect(
      (listB.body.data as Array<{ id: string }>).map((i) => i.id),
    ).not.toContain(created.body.data.id);

    await http()
      .delete(`/api/v1/items/${created.body.data.id}`)
      .set('authorization', `Bearer ${orgB.memberToken}`)
      .expect(404);
  });

  it('soft-deletes items so they disappear from reads', async () => {
    const org = await userWithRole('inv-del', 'MANAGER');

    const created = await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({ name: 'Doomed Item' })
      .expect(201);

    await http()
      .delete(`/api/v1/items/${created.body.data.id}`)
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(204);

    await http()
      .get(`/api/v1/items/${created.body.data.id}`)
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(404);

    const list = await http()
      .get('/api/v1/items')
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(200);
    expect(
      (list.body.data as Array<{ id: string }>).map((i) => i.id),
    ).not.toContain(created.body.data.id);
  });

  it('manages categories and units of measure', async () => {
    const org = await userWithRole('inv-ref', 'MANAGER');

    const cat = await http()
      .post('/api/v1/items/categories')
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({ name: 'Beverages', description: 'Drinks' })
      .expect(201);
    expect(cat.body.data.name).toBe('Beverages');

    await http()
      .post('/api/v1/items/categories')
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({ name: 'Beverages' })
      .expect(409);

    const unit = await http()
      .post('/api/v1/items/units')
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({ name: 'Gram', symbol: 'g' })
      .expect(201);
    expect(unit.body.data.symbol).toBe('g');

    // Item can reference a category (link integrity).
    await http()
      .post('/api/v1/items')
      .set('authorization', `Bearer ${org.memberToken}`)
      .send({ name: 'Categorised Item', categoryId: cat.body.data.id })
      .expect(201);

    await http()
      .delete(`/api/v1/items/categories/${cat.body.data.id}`)
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(204);

    // Categories overlap in list — unit still visible.
    const units = await http()
      .get('/api/v1/items/units')
      .set('authorization', `Bearer ${org.memberToken}`)
      .expect(200);
    expect(
      (units.body.data as Array<{ symbol: string }>).map((u) => u.symbol),
    ).toContain('g');
  });
});