import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Prisma,
  User,
  Organization,
} from '../generated/prisma/client.js';
import { getScope } from '../common/context/request-context.js';

/**
 * Models that carry a `deletedAt` column (soft deletes are read/updated away
 * automatically by the extension below).
 */
const SOFT_DELETE_MODELS = new Set<Prisma.ModelName>([
  Prisma.ModelName.Organization,
  Prisma.ModelName.OrganizationSetting,
  Prisma.ModelName.User,
  Prisma.ModelName.ItemCategory,
  Prisma.ModelName.UnitOfMeasure,
  Prisma.ModelName.Item,
  Prisma.ModelName.Party,
  Prisma.ModelName.Account,
  Prisma.ModelName.BankAccount,
]);

/** Models whose rows are scoped to a tenant via `organizationId`. */
const TENANT_MODELS = new Set<Prisma.ModelName>([
  Prisma.ModelName.OrganizationSetting,
  Prisma.ModelName.User,
  Prisma.ModelName.RefreshToken,
  Prisma.ModelName.EmailVerificationToken,
  Prisma.ModelName.PasswordResetToken,
  Prisma.ModelName.AuditLog,
  Prisma.ModelName.OutboxEvent,
  Prisma.ModelName.IdempotencyKey,
  Prisma.ModelName.ApiKey,
  Prisma.ModelName.ItemCategory,
  Prisma.ModelName.UnitOfMeasure,
  Prisma.ModelName.Item,
  Prisma.ModelName.Party,
  Prisma.ModelName.SaleInvoice,
  Prisma.ModelName.SaleInvoiceLine,
  Prisma.ModelName.Payment,
  Prisma.ModelName.InvoiceNumberSeq,
  Prisma.ModelName.StockMovement,
  Prisma.ModelName.PurchaseInvoice,
  Prisma.ModelName.PurchaseInvoiceLine,
  Prisma.ModelName.PurchaseInvoiceSeq,
  Prisma.ModelName.Account,
  Prisma.ModelName.JournalEntry,
  Prisma.ModelName.JournalEntryLine,
  Prisma.ModelName.JournalEntrySeq,
  Prisma.ModelName.Quotation,
  Prisma.ModelName.QuotationLine,
  Prisma.ModelName.QuotationNumberSeq,
  Prisma.ModelName.PurchaseOrder,
  Prisma.ModelName.PurchaseOrderLine,
  Prisma.ModelName.PurchaseOrderNumberSeq,
  Prisma.ModelName.GoodsReceipt,
  Prisma.ModelName.GoodsReceiptLine,
  Prisma.ModelName.GoodsReceiptNumberSeq,
  Prisma.ModelName.CreditNote,
  Prisma.ModelName.CreditNoteLine,
  Prisma.ModelName.CreditNoteNumberSeq,
  Prisma.ModelName.BankAccount,
  Prisma.ModelName.BankStatementLine,
  Prisma.ModelName.BankReconciliation,
  Prisma.ModelName.Notification,
]);

/** Models that record `createdBy` / `updatedBy` actor ids. */
const AUDITED_MODELS = new Set<Prisma.ModelName>([
  Prisma.ModelName.User,
  Prisma.ModelName.Party,
  Prisma.ModelName.SaleInvoice,
  Prisma.ModelName.Payment,
  Prisma.ModelName.PurchaseInvoice,
  Prisma.ModelName.Account,
  Prisma.ModelName.JournalEntry,
  Prisma.ModelName.Quotation,
  Prisma.ModelName.PurchaseOrder,
  Prisma.ModelName.GoodsReceipt,
  Prisma.ModelName.CreditNote,
]);

type Jsonish = Record<string, unknown>;
type OpArgs = { where?: Jsonish; data?: Jsonish; create?: Jsonish };

function getWhere(args: OpArgs): Jsonish {
  return (args.where ?? {}) as Jsonish;
}

function withOrg(where: Jsonish, organizationId: string): Jsonish {
  return { ...where, organizationId };
}

function withNotDeleted(where: Jsonish): Jsonish {
  return { ...where, deletedAt: null };
}

export interface RequestScope {
  organizationId?: string;
  userId?: string;
}

export function isSoftDeleteModel(model: Prisma.ModelName): boolean {
  return SOFT_DELETE_MODELS.has(model);
}

export function isTenantModel(model: Prisma.ModelName): boolean {
  return TENANT_MODELS.has(model);
}

export function isAuditedModel(model: Prisma.ModelName): boolean {
  return AUDITED_MODELS.has(model);
}

/**
 * Pure transform behind the tenant-isolation client. Kept separate from the
 * Prisma extension so the isolation/soft-delete/audit rules can be unit-tested
 * against arbitrary args without a database. Returns the original `rawArgs`
 * when it is not a plain object (e.g. `null`, `undefined`, DMMF flags).
 */
export function composeQueryArgs(
  model: Prisma.ModelName,
  operation: string,
  rawArgs: unknown,
  scope: RequestScope | undefined,
): unknown {
  if (!rawArgs || typeof rawArgs !== 'object') {
    return rawArgs;
  }
  const args = rawArgs as unknown as OpArgs;

  // ---- soft-delete filtering -------------------------------------
  // Reads and mutations never touch soft-deleted rows. `upsert` also
  // carries an implicit read of the same row, so it is filtered too.
  if (isSoftDeleteModel(model)) {
    if (
      ['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate'].includes(
        operation,
      ) ||
      ['update', 'updateMany', 'upsert', 'deleteMany'].includes(operation)
    ) {
      args.where = withNotDeleted(getWhere(args));
    }
  }

  // ---- tenant isolation ------------------------------------------
  const tenantId =
    (args.data?.organizationId as string | undefined) ??
    (args.create?.organizationId as string | undefined) ??
    scope?.organizationId;

  if (isTenantModel(model) && tenantId) {
    if (operation === 'create') {
      args.data = { ...args.data, organizationId: tenantId };
    } else if (operation === 'upsert') {
      args.where = withOrg(getWhere(args), tenantId);
      args.create = { ...args.create, organizationId: tenantId };
    } else if (
      [
        'findFirst',
        'findFirstOrThrow',
        'findMany',
        'update',
        'updateMany',
        'delete',
        'deleteMany',
      ].includes(operation)
    ) {
      args.where = withOrg(getWhere(args), tenantId);
    }
  }

  // ---- actor audit columns ---------------------------------------
  const actorId = scope?.userId;
  if (isAuditedModel(model) && actorId) {
    if (operation === 'create' && args.data) {
      args.data = {
        ...args.data,
        createdBy: actorId,
        updatedBy: actorId,
      };
    } else if (operation === 'update' && args.data) {
      args.data = { ...args.data, updatedBy: actorId };
    }
  }

  return args;
}

/**
 * Builds the tenant-isolated Prisma client.
 *
 *  - `organizationId`, `createdBy`/`updatedBy` are injected from the request
 *    scope so services can never accidentally cross tenant boundaries.
 *  - Soft-deleted rows are transparently excluded from reads and mutations.
 *  - Logical deletes are performed explicitly by services via
 *    `update({ data: { deletedAt: new Date() } })` — the extension guarantees
 *    the `update` cannot target a soft-deleted row (see `withNotDeleted`).
 */
export function createExtendedPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });

  const base = new PrismaClient({
    adapter,
    log: ['warn', 'error'],
  });

  return base.$extends({
    name: 'tenant-isolation',
    query: {
      $allOperations({ model, operation, args: rawArgs, query }) {
        return query(
          composeQueryArgs(model as Prisma.ModelName, operation, rawArgs, getScope()) as never,
        );
      },
    },
  }) as PrismaClient;
}

/** USERS_READONLY safety projection used before exposing user objects. */
export function publicUser(user: Pick<User, 'id' | 'name' | 'email' | 'role'>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export type { Organization };