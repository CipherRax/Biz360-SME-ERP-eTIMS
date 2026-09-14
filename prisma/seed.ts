import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role, UserStatus } from '../src/generated/prisma/client.js';
import { slugify } from '../src/common/helpers/slugify.js';
import argon2 from 'argon2';

/**
 * Idempotent development seed: one demo organization + admin user.
 * Run with: `npx tsx prisma/seed.ts`
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed refuses to run in production.');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  const orgName = process.env.SEED_ORG_NAME ?? 'Acme Trading Co.';
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@erp.test').toLowerCase().trim();
  const adminExists = await prisma.user.findUnique({ where: { email } });

  if (adminExists) {
    console.log(`Seed skipped — admin ${email} already exists.`);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await argon2.hash(process.env.SEED_ADMIN_PASSWORD ?? 'SuperSecure123!', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: orgName, slug: `${slugify(orgName)}-seed` },
    });
    await tx.user.create({
      data: {
        organizationId: organization.id,
        email,
        name: process.env.SEED_ADMIN_NAME ?? 'ERP Admin',
        passwordHash,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        preferences: { language: 'en', timezone: 'Africa/Nairobi' },
      },
    });
  });

  console.log(`Seeded organization "${orgName}" and admin ${email}`);
  await prisma.$disconnect();
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});