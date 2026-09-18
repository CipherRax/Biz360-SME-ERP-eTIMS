import type { BadgeTone } from '@/components/ui/badge';
import type {
  CreditNoteStatus,
  GoodsReceiptStatus,
  InvoiceStatus,
  JournalEntryStatus,
  PartyStatus,
  PurchaseOrderStatus,
  QuotationStatus,
  Role,
  UserStatus,
} from '@/types/domain';

// Single source of truth for status → label + badge tone, so every table and
// detail page renders the same state the same way.

export interface StatusMeta {
  label: string;
  tone: BadgeTone;
}

export const INVOICE_STATUS: Record<InvoiceStatus, StatusMeta> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmed', tone: 'info' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  VOID: { label: 'Void', tone: 'error' },
};

export const QUOTATION_STATUS: Record<QuotationStatus, StatusMeta> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SENT: { label: 'Sent', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'brand' },
  CONVERTED: { label: 'Converted', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'error' },
};

export const PURCHASE_ORDER_STATUS: Record<PurchaseOrderStatus, StatusMeta> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'brand' },
  RECEIVED: { label: 'Received', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  REJECTED: { label: 'Rejected', tone: 'error' },
  CANCELLED: { label: 'Cancelled', tone: 'error' },
};

export const GOODS_RECEIPT_STATUS: Record<GoodsReceiptStatus, StatusMeta> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'error' },
};

export const CREDIT_NOTE_STATUS: Record<CreditNoteStatus, StatusMeta> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ISSUED: { label: 'Issued', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'error' },
};

export const JOURNAL_STATUS: Record<JournalEntryStatus, StatusMeta> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  POSTED: { label: 'Posted', tone: 'success' },
  REVERSED: { label: 'Reversed', tone: 'warning' },
};

export const PARTY_STATUS: Record<PartyStatus, StatusMeta> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
};

export const USER_STATUS: Record<UserStatus, StatusMeta> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  PENDING: { label: 'Pending', tone: 'warning' },
  SUSPENDED: { label: 'Suspended', tone: 'error' },
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  ACCOUNTANT: 'Accountant',
  STAFF: 'Staff',
  READ_ONLY: 'Read only',
};

export function etimsMeta(submittedAt: string | null | undefined): StatusMeta {
  return submittedAt
    ? { label: 'Submitted to KRA', tone: 'success' }
    : { label: 'Not submitted', tone: 'warning' };
}

export const WHT_PAYMENT_TYPES = [
  'PROFESSIONAL_FEES',
  'SERVICE_FEES',
  'CONTRACTOR_SERVICES',
  'CONSULTANCY',
  'ROYALTIES',
  'RENT',
  'MANAGEMENT_FEES',
  'OTHER',
] as const;
