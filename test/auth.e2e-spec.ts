import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

interface RegisteredUser {
  userId: string;
  organizationId: string;
  devVerificationToken: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  password: string;
}

const PASSWORD = 'E2ePassword123';

describe('SME ERP API (e2e)', () => {
  let app: INestApplication;
  const run = Date.now().toString(36);
  let counter = 0;

  const emailFor = (label: string) => `${label}-${run}-${counter++}@erp.test`;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    process.env.AUTH_LOGIN_LOCKOUT_THRESHOLD = '3';
    process.env.AUTH_LOGIN_LOCKOUT_MS = '60000';
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

  async function login(email: string, password = PASSWORD) {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data as {
      accessToken: string;
      refreshToken: string;
      refreshTokenId: string;
      expiresIn: number;
    };
  }

  /** Admin-provisions a member (created ACTIVE) and logs them in. */
  async function createMemberAndLogin(
    adminToken: string,
    email: string,
    options: { role?: string } = {},
  ): Promise<{ userId: string; accessToken: string }> {
    const res = await http()
      .post('/api/v1/users')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Member',
        email,
        password: PASSWORD,
        role: options.role ?? 'STAFF',
      })
      .expect(201);
    const tokens = await login(email);
    return { userId: res.body.data.id, accessToken: tokens.accessToken };
  }

  async function register(
    email: string,
    options: { verify?: boolean } = {},
  ): Promise<RegisteredUser> {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'E2E User', email, password: PASSWORD, organizationName: 'E2E Org' })
      .expect(201);
    const data = res.body.data as {
      userId: string;
      organizationId: string;
      requiresEmailVerification: boolean;
      devVerificationToken: string;
    };
    expect(data.requiresEmailVerification).toBe(true);
    expect(data.devVerificationToken).toBeTruthy();

    const user: RegisteredUser = {
      userId: data.userId,
      organizationId: data.organizationId,
      devVerificationToken: data.devVerificationToken,
      accessToken: '',
      refreshToken: '',
      email,
      password: PASSWORD,
    };

    if (options.verify !== false) {
      await http()
        .post('/api/v1/auth/verify-email')
        .send({ token: user.devVerificationToken })
        .expect(200);
      const tokens = await login(email);
      user.accessToken = tokens.accessToken;
      user.refreshToken = tokens.refreshToken;
    }
    return user;
  }

  it('register → verify → login → me happy path', async () => {
    const user = await register(emailFor('happy'));

    const me = await http()
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(me.body.data.email).toBe(user.email);
  });

  it('rejects login for an unverified email', async () => {
    const email = emailFor('unverified');
    await register(email, { verify: false });

    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(res.body).toMatchObject({ success: false, data: null });
    expect(res.body.message).toBe('Email not verified');
  });

  it('rejects invalid credentials', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: emailFor('nobody'), password: 'WrongPassword1' })
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  it('locks the account after repeated failed logins', async () => {
    const user = await register(emailFor('lockout'));

    for (let i = 0; i < 3; i++) {
      await http()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'WrongPassword1' })
        .expect(401);
    }

    // Even the correct password is refused while the lock is active.
    const locked = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(403);
    expect(locked.body.message).toBe('Account temporarily locked. Try again later.');
  });

  it('rejects weak passwords on register', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Weak', email: emailFor('weak'), password: 'short' })
      .expect(400);
    expect(res.body).toMatchObject({ success: false, errors: expect.any(Array) });
  });

  it('rotates refresh tokens and revokes a reused family', async () => {
    const user = await register(emailFor('rotate'));
    const oldRefresh = user.refreshToken;

    const first = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);
    const currentRefresh = first.body.data.refreshToken;
    expect(currentRefresh).not.toBe(oldRefresh);

    // Replaying the already-rotated token is treated as theft → family revoked.
    const reuse = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);
    expect(reuse.body.message).toBe('Refresh token reuse detected');

    // Even the newest token in the family is now dead.
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: currentRefresh })
      .expect(401);
  });

  it('logout invalidates the refresh token', async () => {
    const user = await register(emailFor('logout'));
    await http()
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ refreshToken: user.refreshToken })
      .expect(204);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('enforces RBAC across admin/member/manager within one org', async () => {
    const admin = await register(emailFor('org-admin'));

    // Admin provisions a STAFF member (created ACTIVE and verified directly).
    const staffEmail = emailFor('org-staff');
    const staff = await createMemberAndLogin(admin.accessToken, staffEmail);

    // STAFF is locked out of the members list...
    const forbidden = await http()
      .get('/api/v1/users')
      .set('authorization', `Bearer ${staff.accessToken}`)
      .expect(403);
    expect(forbidden.body.success).toBe(false);

    // ...but their own profile works, and they cannot self-promote.
    await http()
      .get('/api/v1/users/me')
      .set('authorization', `Bearer ${staff.accessToken}`)
      .expect(200);

    await http()
      .patch(`/api/v1/users/${staff.userId}`)
      .set('authorization', `Bearer ${staff.accessToken}`)
      .send({ role: 'ADMIN' })
      .expect(403);

    // Admin promotes the member; MANAGER now has list access.
    const promoted = await http()
      .patch(`/api/v1/users/${staff.userId}`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'MANAGER' })
      .expect(200);
    expect(promoted.body.data.role).toBe('MANAGER');

    // Existing access tokens carry the old role claim — re-login for a fresh one.
    const promotedTokens = await login(staffEmail);
    const list = await http()
      .get('/api/v1/users')
      .set('authorization', `Bearer ${promotedTokens.accessToken}`)
      .expect(200);
    const emails = (list.body.data as Array<{ email: string }>).map((u) => u.email);
    expect(emails).toContain(staffEmail);

    // A member of a *different* org cannot read users from this org.
    const outsider = await register(emailFor('outsider'));
    const crossTenant = await http()
      .get(`/api/v1/users/${admin.userId}`)
      .set('authorization', `Bearer ${outsider.accessToken}`)
      .expect(404);
    expect(crossTenant.body.message).toBe('User not found');
  });

  it('soft-deletes a user so login stops working', async () => {
    const admin = await register(emailFor('del-admin'));
    const victimEmail = emailFor('del-victim');
    const victim = await createMemberAndLogin(admin.accessToken, victimEmail);

    const adminListBefore = await http()
      .get('/api/v1/users')
      .set('authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(
      (adminListBefore.body.data as Array<{ email: string }>).some(
        (u) => u.email === victimEmail,
      ),
    ).toBe(true);

    await http()
      .delete(`/api/v1/users/${victim.userId}`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .expect(204);

    // Soft-deleted user can no longer authenticate.
    await http()
      .post('/api/v1/auth/login')
      .send({ email: victimEmail, password: PASSWORD })
      .expect(401);

    // And no longer appears in the org's member list.
    const adminListAfter = await http()
      .get('/api/v1/users')
      .set('authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(
      (adminListAfter.body.data as Array<{ email: string }>).some(
        (u) => u.email === victimEmail,
      ),
    ).toBe(false);
  });
});