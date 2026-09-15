import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import {
  composeQueryArgs,
  isAuditedModel,
  isSoftDeleteModel,
  isTenantModel,
} from './prisma-extensions.js';

const scope = { organizationId: 'org-1', userId: 'user-1' };

describe('prisma tenant-isolation query transform', () => {
  it('classifies models into the right buckets', () => {
    expect(isSoftDeleteModel(Prisma.ModelName.Organization)).toBe(true);
    expect(isSoftDeleteModel(Prisma.ModelName.SaleInvoice)).toBe(false);
    expect(isTenantModel(Prisma.ModelName.JournalEntry)).toBe(true);
    expect(isTenantModel(Prisma.ModelName.Organization)).toBe(false);
    expect(isAuditedModel(Prisma.ModelName.Party)).toBe(true);
    expect(isAuditedModel(Prisma.ModelName.StockMovement)).toBe(false);
  });

  it('injects the tenant into reads and add orgId on create', () => {
    const read = composeQueryArgs(
      Prisma.ModelName.Party,
      'findMany',
      { where: { deletedAt: null } },
      scope,
    ) as { where: Record<string, unknown> };
    expect(read.where).toMatchObject({ organizationId: 'org-1', deletedAt: null });

    const created = composeQueryArgs(
      Prisma.ModelName.Party,
      'create',
      { data: { name: 'X' } },
      scope,
    ) as { data: Record<string, unknown> };
    expect(created.data.organizationId).toBe('org-1');
  });

  it('lets an explicit organizationId on create data win over the scope', () => {
    const created = composeQueryArgs(
      Prisma.ModelName.Party,
      'create',
      { data: { name: 'X', organizationId: 'org-2' } },
      scope,
    ) as { data: Record<string, unknown> };
    expect(created.data.organizationId).toBe('org-2');
  });

  it('adds the tenant when upserting and preserves its create payload', () => {
    const args = composeQueryArgs(
      Prisma.ModelName.OrganizationSetting,
      'upsert',
      { where: { key: 'k' }, create: { value: 'v' }, update: {} },
      scope,
    ) as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(args.where.organizationId).toBe('org-1');
    expect(args.create.organizationId).toBe('org-1');
    expect(args.create.value).toBe('v');
  });

  it('does not touch non-tenant models', () => {
    const args = composeQueryArgs(
      Prisma.ModelName.Organization,
      'findMany',
      { where: { deletedAt: null } },
      scope,
    ) as { where: Record<string, unknown> };
    expect(args.where.organizationId).toBeUndefined();
  });

  it('filters soft-deleted rows on reads and mutations', () => {
    for (const op of ['findMany', 'findFirst', 'count', 'aggregate', 'update', 'upsert']) {
      const args = composeQueryArgs(
        Prisma.ModelName.Item,
        op,
        { where: { id: 'i' } },
        scope,
      ) as { where: Record<string, unknown> };
      expect(args.where.deletedAt, `op ${op}`).toBeNull();
    }
  });

  it('injects actor audit columns on create/update from the scope', () => {
    const created = composeQueryArgs(
      Prisma.ModelName.User,
      'create',
      { data: { name: 'A' } },
      scope,
    ) as { data: Record<string, unknown> };
    expect(created.data.createdBy).toBe('user-1');
    expect(created.data.updatedBy).toBe('user-1');

    const updated = composeQueryArgs(
      Prisma.ModelName.User,
      'update',
      { where: { id: 'u' }, data: { name: 'B' } },
      scope,
    ) as { data: Record<string, unknown> };
    expect(updated.data.updatedBy).toBe('user-1');
    expect(updated.data.createdBy).toBeUndefined();
  });

  it('never audits without an actor in scope', () => {
    const created = composeQueryArgs(
      Prisma.ModelName.Payment,
      'create',
      { data: { amount: 1 } },
      undefined,
    ) as { data: Record<string, unknown> };
    expect(created.data.createdBy).toBeUndefined();
  });

  it('passes through non-object args untouched', () => {
    expect(composeQueryArgs(Prisma.ModelName.Party, 'findMany', null, scope)).toBeNull();
    expect(composeQueryArgs(Prisma.ModelName.Party, 'findMany', undefined, scope)).toBeUndefined();
  });
});