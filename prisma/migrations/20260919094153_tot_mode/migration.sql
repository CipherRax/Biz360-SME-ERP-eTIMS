-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('VAT_STANDARD', 'TURNOVER_TAX', 'EXEMPT');

-- CreateEnum
CREATE TYPE "TotFilingPeriodStatus" AS ENUM ('PENDING', 'PAID');

-- AlterEnum
ALTER TYPE "OutboxEventType" ADD VALUE 'TOT_PAYMENT_STK_PUSH';

-- CreateTable
CREATE TABLE "organization_tax_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'VAT_STANDARD',
    "totRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tot_filing_periods" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossTurnover" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentStatus" "TotFilingPeriodStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tot_filing_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_tax_profiles_organizationId_key" ON "organization_tax_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "tot_filing_periods_organizationId_paymentStatus_idx" ON "tot_filing_periods"("organizationId", "paymentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "tot_filing_periods_organizationId_periodStart_periodEnd_key" ON "tot_filing_periods"("organizationId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "organization_tax_profiles" ADD CONSTRAINT "organization_tax_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tot_filing_periods" ADD CONSTRAINT "tot_filing_periods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
