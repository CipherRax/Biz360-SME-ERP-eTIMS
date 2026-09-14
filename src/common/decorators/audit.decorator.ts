import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';
/** Records an AuditLog row for the decorated route after a successful write. */
export const Audit = (entityType: string) =>
  SetMetadata(AUDIT_KEY, entityType);