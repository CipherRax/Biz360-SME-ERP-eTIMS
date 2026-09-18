-- CreateEnum
CREATE TYPE "SupplierEtimsCaptureMethod" AS ENUM ('MANUAL', 'OCR_SCAN', 'SUPPLIER_PORTAL_SYNC');

-- CreateEnum
CREATE TYPE "SupplierEtimsMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'DISPUTED', 'MISSING_CONFIRMED');

-- CreateEnum
CREATE TYPE "SupplierEtimsVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED_VIA_KRA_QR', 'VERIFICATION_FAILED');

-- CreateEnum
CREATE TYPE "ExpenseComplianceFlagType" AS ENUM ('NO_ETIMS_MATCH', 'PARTIAL_AMOUNT_MISMATCH', 'EXPIRED_MATCH_WINDOW');

-- CreateEnum
CREATE TYPE "WithholdingTaxPaymentType" AS ENUM ('PROFESSIONAL_FEES', 'RENT', 'COMMISSION', 'ROYALTY', 'DIVIDEND', 'INTEREST', 'CONTRACTUAL_FEES', 'OTHER');

-- CreateEnum
CREATE TYPE "WithholdingTaxResidency" AS ENUM ('RESIDENT', 'NON_RESIDENT');

-- CreateEnum
CREATE TYPE "WithholdingTaxDeductionStatus" AS ENUM ('CALCULATED', 'DEDUCTED', 'CERTIFICATE_GENERATED', 'REMITTED');

-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "kraPinVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "supplier_etims_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kraInvoiceNumber" TEXT NOT NULL,
    "kraControlUnitId" TEXT,
    "kraQrCodeData" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "captureMethod" "SupplierEtimsCaptureMethod" NOT NULL DEFAULT 'MANUAL',
    "matchedPurchaseInvoiceId" TEXT,
    "matchStatus" "SupplierEtimsMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "verificationStatus" "SupplierEtimsVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "attachmentUrl" TEXT,
    "ocrJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_etims_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_compliance_flags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "flagType" "ExpenseComplianceFlagType" NOT NULL,
    "amountMismatch" DECIMAL(18,2),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_compliance_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withholding_tax_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "paymentType" "WithholdingTaxPaymentType" NOT NULL,
    "residency" "WithholdingTaxResidency" NOT NULL DEFAULT 'RESIDENT',
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withholding_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withholding_tax_deductions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierPaymentId" TEXT,
    "paymentType" "WithholdingTaxPaymentType" NOT NULL DEFAULT 'PROFESSIONAL_FEES',
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "whtAmount" DECIMAL(18,2) NOT NULL,
    "netPayableAmount" DECIMAL(18,2) NOT NULL,
    "kraWhtCertificateNumber" TEXT,
    "status" "WithholdingTaxDeductionStatus" NOT NULL DEFAULT 'CALCULATED',
    "remittanceDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withholding_tax_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_etims_invoices_organizationId_idx" ON "supplier_etims_invoices"("organizationId");

-- CreateIndex
CREATE INDEX "supplier_etims_invoices_organizationId_matchStatus_idx" ON "supplier_etims_invoices"("organizationId", "matchStatus");

-- CreateIndex
CREATE INDEX "supplier_etims_invoices_organizationId_supplierId_idx" ON "supplier_etims_invoices"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_etims_invoices_organizationId_invoiceDate_idx" ON "supplier_etims_invoices"("organizationId", "invoiceDate");

-- CreateIndex
CREATE INDEX "expense_compliance_flags_organizationId_flagType_idx" ON "expense_compliance_flags"("organizationId", "flagType");

-- CreateIndex
CREATE INDEX "expense_compliance_flags_organizationId_purchaseInvoiceId_idx" ON "expense_compliance_flags"("organizationId", "purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "expense_compliance_flags_purchaseInvoiceId_idx" ON "expense_compliance_flags"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "withholding_tax_rates_organizationId_paymentType_residency__idx" ON "withholding_tax_rates"("organizationId", "paymentType", "residency", "effectiveFrom");

-- CreateIndex
CREATE INDEX "withholding_tax_deductions_organizationId_status_idx" ON "withholding_tax_deductions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "withholding_tax_deductions_organizationId_supplierId_idx" ON "withholding_tax_deductions"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "withholding_tax_deductions_organizationId_createdAt_idx" ON "withholding_tax_deductions"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "supplier_etims_invoices" ADD CONSTRAINT "supplier_etims_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_invoices" ADD CONSTRAINT "supplier_etims_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_invoices" ADD CONSTRAINT "supplier_etims_invoices_matchedPurchaseInvoiceId_fkey" FOREIGN KEY ("matchedPurchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_compliance_flags" ADD CONSTRAINT "expense_compliance_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_compliance_flags" ADD CONSTRAINT "expense_compliance_flags_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_tax_rates" ADD CONSTRAINT "withholding_tax_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_tax_deductions" ADD CONSTRAINT "withholding_tax_deductions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_tax_deductions" ADD CONSTRAINT "withholding_tax_deductions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_tax_deductions" ADD CONSTRAINT "withholding_tax_deductions_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
