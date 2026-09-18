// Mutation input DTOs mirroring the backend request bodies. Decimal-valued
// fields are typed as strings (e.g. "1500.00") exactly as the API expects.

import type {
  AccountType,
  BankAccountType,
  Currency,
  InvoiceStatus,
  PartyStatus,
  PartyType,
  PaymentMethod,
  PurchaseOrderStatus,
  Role,
  SupplierEtimsCaptureMethod,
  UserStatus,
  WithholdingTaxPaymentType,
  WithholdingTaxResidency,
} from './domain';

export interface DocumentLineInput {
  itemId?: string;
  description?: string;
  quantity?: string;
  unitPrice?: string;
  taxRate?: string;
  discountPct?: string;
  lineDiscount?: string;
}

// ---- Kenya compliance (addendum Tier 1) -------------------------------------
export interface CaptureSupplierEtimsInput {
  supplierId: string;
  kraInvoiceNumber: string;
  kraControlUnitId?: string;
  kraQrCodeData?: string;
  invoiceDate: string;
  amount: string;
  vatAmount?: string;
  captureMethod?: SupplierEtimsCaptureMethod;
}

export interface ScanSupplierEtimsInput {
  data: string;
  supplierId?: string;
}

export interface MatchSupplierEtimsInput {
  purchaseInvoiceId: string;
}

export interface UpsertWhtRateInput {
  paymentType: WithholdingTaxPaymentType;
  residency: WithholdingTaxResidency;
  ratePercent: string;
  defaults?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface RecordWhtInput {
  paymentId: string;
}

export interface CaptureSupplierEtimsCreditNoteInput {
  supplierId: string;
  kraInvoiceNumber: string;
  originalInvoiceNumber?: string;
  originalEtimsInvoiceId?: string;
  originalPurchaseInvoiceId?: string;
  kraQrCodeData?: string;
  creditNoteDate: string;
  amount: string;
  vatAmount?: string;
  reason?: string;
  captureMethod?: SupplierEtimsCaptureMethod;
}

export interface MatchSupplierEtimsCreditNoteInput {
  originalEtimsInvoiceId?: string;
  purchaseInvoiceId?: string;
  whtOffsetDeductionId?: string;
}

export interface PartyInput {
  type: PartyType;
  name: string;
  email?: string;
  phone?: string;
  taxId?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  creditLimit?: string;
  paymentTermsDays?: number;
  notes?: string;
  status?: PartyStatus;
}

export interface ItemInput {
  name?: string;
  sku?: string;
  description?: string;
  categoryId?: string;
  baseUnit?: string;
  buyPrice?: string;
  sellPrice?: string;
  taxCode?: string;
  reorderLevel?: string;
  active?: boolean;
  trackStock?: boolean;
}

export interface InvoiceInput {
  partyId: string;
  lines: DocumentLineInput[];
  invoiceDate?: string;
  notes?: string;
  currency?: string;
}

export interface PaymentInput {
  invoiceId: string;
  amount: string;
  method?: PaymentMethod;
  reference?: string;
  paidAt?: string;
  notes?: string;
}

export interface PurchasePaymentInput {
  purchaseInvoiceId: string;
  amount: string;
  method?: PaymentMethod;
  reference?: string;
  paidAt?: string;
  notes?: string;
}

export interface QuotationInput {
  partyId: string;
  lines: DocumentLineInput[];
  quoteDate?: string;
  validUntil?: string;
  notes?: string;
  currency?: string;
}

export interface CreditNoteInput {
  partyId: string;
  referenceInvoiceId?: string;
  lines: DocumentLineInput[];
  reason?: string;
  noteDate?: string;
  currency?: string;
}

export interface PurchaseInvoiceInput {
  partyId: string;
  supplierRef?: string;
  invoiceDate?: string;
  currency?: string;
  notes?: string;
  lines: Array<DocumentLineInput & { quantity: string; unitPrice: string }>;
}

export interface PurchaseOrderInput {
  partyId: string;
  orderDate?: string;
  expectedDate?: string;
  currency?: string;
  notes?: string;
  lines: Array<DocumentLineInput & { quantity: string; unitPrice: string }>;
}

export interface GoodsReceiptInput {
  purchaseOrderId: string;
  receivedDate?: string;
  notes?: string;
  lines: Array<{ poLineId: string; quantity: string; notes?: string }>;
}

export interface AccountInput {
  code: string;
  name: string;
  type: AccountType;
  parentId?: string;
  description?: string;
}

export interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface JournalEntryInput {
  entryDate?: string;
  description?: string;
  lines: JournalLineInput[];
}

export interface UserInput {
  name: string;
  email: string;
  password: string;
  role?: Role;
}

export interface UpdateUserInput {
  role?: Role;
  status?: UserStatus;
}

export interface OrganizationInput {
  name?: string;
  taxPin?: string;
  contactEmail?: string;
  contactPhone?: string;
  currency?: Currency;
}

export interface OrganizationSettingsInput {
  taxRate?: string;
  currency?: Currency;
  invoiceNumberFormat?: string;
  defaultPaymentTermsDays?: string;
  financialYearStart?: string;
}

export interface ApiKeyInput {
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}

export interface BankAccountInput {
  name?: string;
  accountType?: BankAccountType;
  accountCode?: string;
  bankName?: string;
  accountNumber?: string;
  openingBalance?: number;
  active?: boolean;
}

export type InvoiceListFilters = {
  status?: InvoiceStatus;
  partyId?: string;
};

export type PurchaseOrderListFilters = {
  status?: PurchaseOrderStatus;
  partyId?: string;
};