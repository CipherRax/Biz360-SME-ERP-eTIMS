import { Injectable } from '@nestjs/common';
import { ExpenseComplianceFlagType, Prisma } from '../../../generated/prisma/client.js';

/**
 * Creates expense-compliance flags when a purchase invoice has no matching
 * supplier eTIMS receipt (A1). Called inside the purchasing transaction so
 * flags and the invoice are created atomically.
 */
@Injectable()
export class ExpenseComplianceService {
  /**
   * @param tx     active transaction client from the invoking service
   * @param purchase id/partyId/total/invoiceDate of the just-created invoice
   */
  async flagForUnmatchedSupplierInvoice(
    tx: Prisma.TransactionClient,
    organizationId: string,
    purchase: { id: string; partyId: string; total: Prisma.Decimal; invoiceDate: Date },
  ): Promise<void> {
    const hasEtimsReceipt = await tx.supplierEtimsInvoice.findFirst({
      where: {
        organizationId,
        supplierId: purchase.partyId,
        amount: { equals: purchase.total },
        invoiceDate: {
          gte: startOfDay(purchase.invoiceDate),
          lte: endOfDay(purchase.invoiceDate),
        },
        verificationStatus: { not: 'VERIFICATION_FAILED' },
      },
      select: { id: true },
    });
    if (hasEtimsReceipt) return;

    await tx.expenseComplianceFlag.create({
      data: {
        organizationId,
        purchaseInvoiceId: purchase.id,
        flagType: ExpenseComplianceFlagType.NO_ETIMS_MATCH,
      },
    });
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}