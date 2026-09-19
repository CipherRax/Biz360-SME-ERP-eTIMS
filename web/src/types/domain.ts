// Domain types mirroring the backend Prisma schema + controllers.
// Money/quantities are decimal STRINGS on the wire for mutations and DECIMAL
// NUMBERS in responses — never float math in the UI.

// ---- Enums (exact backend values) -----------------------------------------
export type Role = 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'STAFF' | 'READ_ONLY';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';
export type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
export type PartyStatus = 'ACTIVE' | 'INACTIVE';
export type InvoiceType = 'INVOICE' | 'CREDIT_NOTE';
export type InvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type PaymentMethod = 'CASH' | 'M_PESA' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE';
export type StockMovementType = 'ADJUSTMENT' | 'PURCHASE_IN' | 'SALE_OUT' | 'VOID';
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type JournalSourceType =
  | 'MANUAL'
  | 'SALE_INVOICE'
  | 'SALE_COGS'
  | 'SALE_COGS_REVERSAL'
  | 'SALE_PAYMENT'
  | 'SALE_PAYMENT_REVERSAL'
  | 'SALE_VOID'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_PAYMENT'
  | 'PURCHASE_PAYMENT_REVERSAL'
  | 'PURCHASE_VOID'
  | 'REVERSAL'
  | 'CREDIT_NOTE';
export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED';
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'RECEIVED'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELLED';
export type GoodsReceiptStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type CreditNoteStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';
export type BankAccountType = 'BANK' | 'M_PESA' | 'CASH' | 'MOBILE_MONEY';
export type NotificationType =
  | 'LOW_STOCK'
  | 'INVOICE_CONFIRMED'
  | 'INVOICE_PAID'
  | 'PO_APPROVED'
  | 'PO_REJECTED'
  | 'PAYMENT_RECEIVED'
  | 'SYSTEM'
  | 'CUSTOM';
export type NotificationStatus = 'UNREAD' | 'READ' | 'ARCHIVED';
export type Currency = 'KES' | 'USD' | 'EUR' | 'GBP' | 'UGX' | 'TZS';

// ---- Auth ------------------------------------------------------------------
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  expiresIn: number;
}

export interface RefreshResult extends TokenPair {
  user: { sub: string; email: string; role: Role; orgId: string };
}

export interface SessionDevice {
  id: string;
  familyId: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface CurrentUser {
  sub: string;
  email: string;
  role: Role;
  orgId: string;
}

// ---- Organizations & users -------------------------------------------------
export interface Organization {
  id: string;
  name: string;
  slug: string;
  taxPin?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  currency: Currency;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSetting {
  id: string;
  organizationId: string;
  taxRate: string;
  currency: Currency;
  invoiceNumberFormat: string;
  defaultPaymentTermsDays: number;
  financialYearStart?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: Role;
  status: UserStatus;
  preferences?: Record<string, unknown> | null;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
}

// ---- Parties (customers & suppliers) ---------------------------------------
export interface Party {
  id: string;
  type: PartyType;
  name: string;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  kraPinVerifiedAt?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  creditLimit?: string | null;
  paymentTermsDays?: number | null;
  notes?: string | null;
  status: PartyStatus;
  createdAt: string;
  updatedAt: string;
}

// ---- Inventory -------------------------------------------------------------
export interface Item {
  id: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  baseUnit?: string;
  buyPrice?: string | null;
  sellPrice?: string | null;
  taxCode?: string | null;
  stockOnHand: number;
  trackStock?: boolean;
  reorderLevel?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  item?: { id: string; name: string; sku?: string | null };
  quantity: number;
  type: StockMovementType;
  reason?: string | null;
  referenceId?: string | null;
  userId?: string | null;
  createdAt: string;
}

export interface StockSummaryEntry {
  itemId: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  stockOnHand: number;
  unitCost: number;
  valuation: number;
  reorderLevel: number;
  lowStock: boolean;
}

export interface StockSummary {
  items: StockSummaryEntry[];
  totals: { items: number; units: number; valuation: number };
}

// ---- Sales documents -------------------------------------------------------
export interface DocumentParty {
  id: string;
  name: string;
  type: PartyType;
  taxId?: string | null;
}

export interface DocumentLine {
  id: string;
  itemId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPct: number;
  lineDiscount: number;
  lineAmount: number;
  lineTotal: number;
  taxAmount: number;
}

export interface DocumentTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: InvoiceType;
  partyId: string;
  party: DocumentParty;
  invoiceDate: string;
  dueDate?: string | null;
  status: InvoiceStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  currency: Currency;
  notes?: string | null;
  etimsSubmittedAt?: string | null;
  etimsCtrlNo?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  lines?: DocumentLine[];
  payments?: Payment[];
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  partyId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  paidAt: string;
  notes?: string | null;
  createdAt: string;
}

export type PurchaseInvoice = Omit<Invoice, 'type'>;

export interface Quotation {
  id: string;
  quoteNumber: string;
  partyId: string;
  party: DocumentParty;
  quoteDate: string;
  validUntil?: string | null;
  status: QuotationStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: Currency;
  notes?: string | null;
  convertedInvoiceId?: string | null;
  lines?: DocumentLine[];
  createdAt: string;
  updatedAt: string;
}

export interface CreditNote {
  id: string;
  noteNumber: string;
  partyId: string;
  party: DocumentParty;
  referenceInvoiceId?: string | null;
  noteDate: string;
  status: CreditNoteStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: Currency;
  reason?: string | null;
  etimsCtrlNo?: string | null;
  etimsReceipt?: string | null;
  etimsSubmittedAt?: string | null;
  lines?: DocumentLine[];
  createdAt: string;
  updatedAt: string;
}

// ---- Purchases -------------------------------------------------------------
export interface PurchaseOrderLine extends DocumentLine {
  receivedQty?: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  partyId: string;
  party: DocumentParty;
  orderDate: string;
  expectedDate?: string | null;
  status: PurchaseOrderStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: Currency;
  notes?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedReason?: string | null;
  lines?: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
}

export interface GoodsReceiptLine {
  id: string;
  poLineId: string;
  itemId?: string | null;
  item?: { id: string; name: string };
  description?: string | null;
  quantity: number;
  notes?: string | null;
}

export interface GoodsReceipt {
  id: string;
  grnNumber: string;
  purchaseOrderId: string;
  purchaseOrder?: { id: string; poNumber: string; status: PurchaseOrderStatus };
  partyId: string;
  party: DocumentParty;
  receivedDate: string;
  status: GoodsReceiptStatus;
  notes?: string | null;
  lines?: GoodsReceiptLine[];
  createdAt: string;
  updatedAt: string;
}

// ---- Accounting ------------------------------------------------------------
export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId?: string | null;
  description?: string | null;
  active: boolean;
  balance?: number;
  children?: Account[];
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntryLine {
  id: string;
  accountId: string;
  account?: { id: string; code: string; name: string; type: AccountType };
  debit: number;
  credit: number;
  memo?: string | null;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  status: JournalEntryStatus;
  sourceType: JournalSourceType;
  sourceId?: string | null;
  description?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  lines?: JournalEntryLine[];
  createdAt: string;
  updatedAt: string;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  side: 'debit' | 'credit';
  balance: number;
}

export interface TrialBalance {
  from: string;
  to: string;
  accounts: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface ProfitLossReport {
  from: string;
  to: string;
  income: { accountId: string; code: string; name: string; balance: number }[];
  totalIncome: number;
  expenses: { accountId: string; code: string; name: string; balance: number }[];
  totalExpenses: number;
  netIncome: number;
}

export interface GeneralLedgerEntry {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: JournalSourceType;
  sourceId?: string | null;
  entryDescription?: string | null;
  account: { id: string; code: string; name: string; type: AccountType };
  debit: number;
  credit: number;
  memo?: string | null;
  runningBalance: number;
}

// ---- Reporting -------------------------------------------------------------
export interface DashboardKpis {
  salesToday: number;
  salesThisMonth: number;
  invoicesThisMonth: number;
  receivables: number;
  payables: number;
  stockValuation: number;
  stockUnits: number;
  lowStockItems: number;
  unsubmittedEtimsInvoices: number;
}

export interface AgedPartiesRow {
  partyId: string;
  partyName: string;
  totalOutstanding: number;
  current: number;
  days30: number;
  days60: number;
  over90: number;
}

export interface AgedParties {
  parties: AgedPartiesRow[];
  totalOutstanding: number;
}

export interface TaxSummary {
  startDate: string;
  endDate: string;
  outputVat: number;
  inputVat: number;
  netVat: number;
  salesInvoiceCount: number;
  purchaseInvoiceCount: number;
}

export interface TopItem {
  itemId: string;
  name: string;
  qty: number;
  revenue: number;
  tax: number;
}

// ---- eTIMS ----------------------------------------------------------------
export interface EtimsStatus {
  mode: 'mock' | 'live';
  taxpayerPinConfigured: boolean;
  deviceSerialConfigured: boolean;
  orgTaxPinPresent: boolean;
  liveReady: boolean;
  unsubmittedInvoices: number;
}

export interface EtimsTriggerResult {
  enqueued: boolean;
  invoiceNumber: string;
  alreadySubmitted: boolean;
  alreadyQueued?: boolean;
}

// ---- API keys & notifications & banking ------------------------------------
export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  key?: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  title: string;
  message?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface BankAccount {
  id: string;
  organizationId: string;
  name: string;
  accountType: BankAccountType;
  accountCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  openingBalance: number;
  currentBalance: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StatementLine {
  id: string;
  organizationId: string;
  accountId: string;
  transactionDate: string;
  description?: string | null;
  reference?: string | null;
  debit: number;
  credit: number;
  reconciled: boolean;
  reconciledAt?: string | null;
  createdAt: string;
}

// ---- Kenya compliance (addendum Tier 1) -------------------------------------
export type SupplierEtimsCaptureMethod = 'MANUAL' | 'SCAN' | 'OCR_SCAN' | 'BULK_IMPORT' | 'SUPPLIER_PORTAL_SYNC';
export type SupplierEtimsMatchStatus = 'UNMATCHED' | 'MATCHED' | 'DISPUTED';
export type SupplierEtimsVerificationStatus =
  | 'UNVERIFIED'
  | 'VERIFIED_VIA_KRA_QR'
  | 'VERIFIED_KRA_LOOKUP'
  | 'VERIFICATION_FAILED';
export type WithholdingTaxPaymentType =
  | 'PROFESSIONAL_FEES'
  | 'SERVICE_FEES'
  | 'CONTRACTOR_SERVICES'
  | 'CONSULTANCY'
  | 'ROYALTIES'
  | 'RENT'
  | 'MANAGEMENT_FEES'
  | 'OTHER';
export type WithholdingTaxResidency = 'RESIDENT' | 'NON_RESIDENT';
export type WithholdingTaxDeductionStatus = 'CALCULATED' | 'WITHHELD' | 'REMITTED';

export interface SupplierEtimsInvoice {
  id: string;
  supplierId: string;
  supplier: { id: string; name: string; taxId?: string | null };
  kraInvoiceNumber: string;
  kraControlUnitId?: string | null;
  invoiceDate: string;
  amount: number;
  vatAmount: number;
  captureMethod: SupplierEtimsCaptureMethod;
  matchedPurchaseInvoiceId?: string | null;
  matchedPurchaseInvoice?: { id: string; invoiceNumber: string } | null;
  matchStatus: SupplierEtimsMatchStatus;
  verificationStatus: SupplierEtimsVerificationStatus;
  attachmentUrl?: string | null;
  createdAt: string;
}

export interface UnmatchedExpense {
  purchaseInvoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplier: string;
  amount: number;
  invoiceDate: string;
  flaggedAt?: string | null;
}

export interface EtimsExposureSummary {
  unmatchedCount: number;
  totalExposure: number;
  creditedAmount: number;
  creditNoteCount: number;
  oldestUnmatchedAt?: string | null;
  agesInDays: number;
}

export interface SupplierEtimsCreditNote {
  id: string;
  supplierId: string;
  supplier: { id: string; name: string; taxId?: string | null };
  kraInvoiceNumber: string;
  originalInvoiceNumber?: string | null;
  originalEtimsInvoiceId?: string | null;
  originalPurchaseInvoiceId?: string | null;
  originalPurchaseInvoice?: { id: string; invoiceNumber: string } | null;
  creditNoteDate: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  reason?: string | null;
  captureMethod: SupplierEtimsCaptureMethod;
  matchStatus: SupplierEtimsMatchStatus;
  verificationStatus: SupplierEtimsVerificationStatus;
  whtOffsetAmount?: number | null;
  whtOffsetDeductionId?: string | null;
  createdAt: string;
}

export interface ScanResult {
  jobId: string;
  invoiceId?: string | null;
  status: string;
  message: string;
}

export interface ScanJobStatus {
  jobId: string;
  jobStatus: string;
  attempts: number;
  error?: string | null;
  processedAt?: string | null;
  extracted?: SupplierEtimsInvoice | null;
}

export interface WhtRate {
  id: string;
  organizationId?: string | null;
  paymentType: WithholdingTaxPaymentType;
  residency: WithholdingTaxResidency;
  ratePercent: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  updatedAt: string;
}

export interface WhtRatesResponse {
  systemDefaults: WhtRate[];
  organizationOverrides: WhtRate[];
}

export interface WhtComputeResult {
  paymentId: string;
  grossAmount: string;
  ratePercent: string;
  whtAmount: string;
  netPayableAmount: string;
  rateSource: 'system' | 'custom';
}

export interface WithholdingTaxDeduction {
  id: string;
  supplierId: string;
  supplier: { name: string; taxId?: string | null };
  supplierPaymentId?: string | null;
  paymentType: WithholdingTaxPaymentType;
  grossAmount: string;
  ratePercent: string;
  whtAmount: string;
  netPayableAmount: string;
  status: WithholdingTaxDeductionStatus;
  kraWhtCertificateNumber?: string | null;
  remittanceDate?: string | null;
  createdAt: string;
}

export interface WhtRemittanceSummary {
  range: { from: string; to: string };
  totals: {
    grossAmount: string;
    whtAmount: string;
    offsetAmount: string;
    remittableWhtAmount: string;
    count: number;
    offsetCount: number;
  };
  byPaymentType: Array<{
    paymentType: WithholdingTaxPaymentType;
    grossAmount: string;
    whtAmount: string;
    count: number;
  }>;
  pendingRemittance: WithholdingTaxDeduction[];
}

// ---- Tier 2: Upload queue + reconciliation --------------------------------

export type SupplierEtimsUploadStatus = 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type SupplierEtimsUploadItemStatus = 'QUEUED' | 'PROCESSED' | 'DUPLICATE' | 'ERROR';

export interface SupplierEtimsUpload {
  id: string;
  filename: string;
  variant: string;
  period?: string | null;
  totalItems: number;
  processedItems: number;
  status: SupplierEtimsUploadStatus;
  errorSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierEtimsUploadItem {
  id: string;
  rowIndex: number;
  supplierTin?: string | null;
  supplierName?: string | null;
  kraInvoiceNumber?: string | null;
  invoiceDate?: string | null;
  amount?: number | null;
  vatAmount?: number | null;
  status: SupplierEtimsUploadItemStatus;
  error?: string | null;
  createdSupplierEtimsInvoiceId?: string | null;
  processedAt?: string | null;
}

export interface PurchaseLedgerReconciliation {
  summary: {
    unpaidCount: number;
    unpaidTotal: string;
    voidedCount: number;
    voidedWithEtimsCount: number;
  };
  unpaid: Array<{
    purchaseInvoiceId: string;
    invoiceNumber: string;
    supplierId: string;
    supplier: string;
    supplierTaxId?: string | null;
    invoiceDate: string;
    dueDate?: string | null;
    total: string;
    amountPaid: string;
    outstanding: string;
    etimsMatched: boolean;
    etimsMatchStatus?: string | null;
  }>;
  voided: Array<{
    purchaseInvoiceId: string;
    invoiceNumber: string;
    supplier: string;
    supplierTaxId?: string | null;
    voidedAt?: string | null;
    voidReason?: string | null;
    etimsReceiptLinked: boolean;
  }>;
}

export type DriftType = 'UNVERIFIED' | 'MATCH_STALE' | 'MISSING_QR' | 'VERIFICATION_FAILED';

export interface DriftItem {
  invoiceId: string;
  kraInvoiceNumber: string;
  supplierName: string;
  amount: string;
  driftType: DriftType;
  detail: string;
  createdAt: string;
}

export interface DriftReport {
  generatedAt: string;
  totalInvoices: number;
  driftCount: number;
  drifts: DriftItem[];
  byType: Record<string, number>;
}