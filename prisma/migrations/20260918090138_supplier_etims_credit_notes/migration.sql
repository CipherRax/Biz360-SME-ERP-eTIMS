-- AlterEnum
ALTER TYPE "OutboxEventType" ADD VALUE 'ETIMS_SUPPLIER_CREDIT_VERIFY';

-- CreateTable
CREATE TABLE "supplier_etims_credit_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kraInvoiceNumber" TEXT NOT NULL,
    "originalInvoiceNumber" TEXT,
    "originalEtimsInvoiceId" TEXT,
    "originalPurchaseInvoiceId" TEXT,
    "creditNoteDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "captureMethod" "SupplierEtimsCaptureMethod" NOT NULL DEFAULT 'MANUAL',
    "matchStatus" "SupplierEtimsMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "verificationStatus" "SupplierEtimsVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "kraQrCodeData" TEXT,
    "attachmentUrl" TEXT,
    "whtOffsetAmount" DECIMAL(18,2),
    "whtOffsetDeductionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_etims_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_etims_credit_notes_organizationId_idx" ON "supplier_etims_credit_notes"("organizationId");

-- CreateIndex
CREATE INDEX "supplier_etims_credit_notes_organizationId_matchStatus_idx" ON "supplier_etims_credit_notes"("organizationId", "matchStatus");

-- CreateIndex
CREATE INDEX "supplier_etims_credit_notes_organizationId_supplierId_idx" ON "supplier_etims_credit_notes"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_etims_credit_notes_organizationId_creditNoteDate_idx" ON "supplier_etims_credit_notes"("organizationId", "creditNoteDate");

-- CreateIndex
CREATE INDEX "supplier_etims_credit_notes_organizationId_originalEtimsInv_idx" ON "supplier_etims_credit_notes"("organizationId", "originalEtimsInvoiceId");

-- CreateIndex
CREATE INDEX "supplier_etims_credit_notes_organizationId_originalPurchase_idx" ON "supplier_etims_credit_notes"("organizationId", "originalPurchaseInvoiceId");

-- CreateIndex
CREATE INDEX "supplier_etims_credit_notes_organizationId_whtOffsetDeducti_idx" ON "supplier_etims_credit_notes"("organizationId", "whtOffsetDeductionId");

-- AddForeignKey
ALTER TABLE "supplier_etims_credit_notes" ADD CONSTRAINT "supplier_etims_credit_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_credit_notes" ADD CONSTRAINT "supplier_etims_credit_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_credit_notes" ADD CONSTRAINT "supplier_etims_credit_notes_originalEtimsInvoiceId_fkey" FOREIGN KEY ("originalEtimsInvoiceId") REFERENCES "supplier_etims_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_credit_notes" ADD CONSTRAINT "supplier_etims_credit_notes_originalPurchaseInvoiceId_fkey" FOREIGN KEY ("originalPurchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_credit_notes" ADD CONSTRAINT "supplier_etims_credit_notes_whtOffsetDeductionId_fkey" FOREIGN KEY ("whtOffsetDeductionId") REFERENCES "withholding_tax_deductions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
