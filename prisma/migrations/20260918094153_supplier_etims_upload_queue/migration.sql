-- CreateEnum
CREATE TYPE "SupplierEtimsUploadStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SupplierEtimsUploadItemStatus" AS ENUM ('QUEUED', 'PROCESSED', 'DUPLICATE', 'ERROR');

-- AlterEnum
ALTER TYPE "OutboxEventType" ADD VALUE 'ETIMS_BULK_IMPORT';

-- CreateTable
CREATE TABLE "supplier_etims_uploads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'ETR',
    "period" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplierEtimsUploadStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_etims_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_etims_upload_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "supplierTin" TEXT,
    "supplierName" TEXT,
    "kraInvoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "amount" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "rawRecord" TEXT,
    "status" "SupplierEtimsUploadItemStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "createdSupplierEtimsInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_etims_upload_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_etims_uploads_organizationId_status_idx" ON "supplier_etims_uploads"("organizationId", "status");

-- CreateIndex
CREATE INDEX "supplier_etims_uploads_organizationId_createdAt_idx" ON "supplier_etims_uploads"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_etims_upload_items_uploadId_idx" ON "supplier_etims_upload_items"("uploadId");

-- CreateIndex
CREATE INDEX "supplier_etims_upload_items_organizationId_status_idx" ON "supplier_etims_upload_items"("organizationId", "status");

-- CreateIndex
CREATE INDEX "supplier_etims_upload_items_organizationId_supplierTin_idx" ON "supplier_etims_upload_items"("organizationId", "supplierTin");

-- AddForeignKey
ALTER TABLE "supplier_etims_uploads" ADD CONSTRAINT "supplier_etims_uploads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_upload_items" ADD CONSTRAINT "supplier_etims_upload_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_upload_items" ADD CONSTRAINT "supplier_etims_upload_items_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "supplier_etims_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_etims_upload_items" ADD CONSTRAINT "supplier_etims_upload_items_createdSupplierEtimsInvoiceId_fkey" FOREIGN KEY ("createdSupplierEtimsInvoiceId") REFERENCES "supplier_etims_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
