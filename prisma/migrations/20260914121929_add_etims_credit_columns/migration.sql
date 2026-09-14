-- AlterTable
ALTER TABLE "sale_invoices" ADD COLUMN     "etimsCreditCtrlNo" TEXT,
ADD COLUMN     "etimsCreditReceipt" TEXT,
ADD COLUMN     "etimsCreditSubmittedAt" TIMESTAMP(3);
