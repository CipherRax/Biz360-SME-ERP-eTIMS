import { Injectable, Logger } from '@nestjs/common';
import { SupplierEtimsMatchStatus, SupplierEtimsVerificationStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

export interface DriftItem {
  invoiceId: string;
  kraInvoiceNumber: string;
  supplierName: string;
  amount: string;
  driftType: 'UNVERIFIED' | 'MATCH_STALE' | 'MISSING_QR' | 'VERIFICATION_FAILED';
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

@Injectable()
export class EtimsDriftService {
  private readonly logger = new Logger(EtimsDriftService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a drift report for an organization's eTIMS invoices.
   *
   * Drift types:
   * - UNVERIFIED: Invoice captured but never sent to KRA / no verification attempt
   * - MATCH_STALE: Invoice matched to a purchase but match status is STALE (data changed since match)
   * - MISSING_QR: Invoice captured via OCR/bulk but QR code data is missing
   * - VERIFICATION_FAILED: Invoice was sent to KRA and verification failed
   */
  async generateReport(organizationId: string): Promise<DriftReport> {
    this.logger.log(`[drift] generating report for org ${organizationId}`);

    const invoices = await this.prisma.client.supplierEtimsInvoice.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const drifts: DriftItem[] = [];

    for (const inv of invoices) {
      const amount = inv.amount.toString();
      const base = {
        invoiceId: inv.id,
        kraInvoiceNumber: inv.kraInvoiceNumber,
        supplierName: inv.supplier?.name ?? 'Unknown',
        amount,
        createdAt: inv.createdAt.toISOString(),
      };

      // Check verification status
      if (inv.verificationStatus === SupplierEtimsVerificationStatus.UNVERIFIED) {
        drifts.push({
          ...base,
          driftType: 'UNVERIFIED',
          detail: 'Invoice captured but never verified against KRA',
        });
        continue;
      }

      if (inv.verificationStatus === SupplierEtimsVerificationStatus.VERIFICATION_FAILED) {
        drifts.push({
          ...base,
          driftType: 'VERIFICATION_FAILED',
          detail: 'KRA verification failed — invoice may not be valid',
        });
        continue;
      }

      // Check match status for stale matches
      if (inv.matchStatus === SupplierEtimsMatchStatus.MATCHED && inv.matchedPurchaseInvoiceId) {
        const purchase = await this.prisma.client.purchaseInvoice.findUnique({
          where: { id: inv.matchedPurchaseInvoiceId },
          select: { id: true, updatedAt: true },
        });

        if (purchase) {
          const matchDate = inv.updatedAt;
          const purchaseUpdated = purchase.updatedAt;
          if (purchaseUpdated > matchDate) {
            drifts.push({
              ...base,
              driftType: 'MATCH_STALE',
              detail: `Purchase invoice updated (${purchaseUpdated.toISOString()}) after match (${matchDate.toISOString()})`,
            });
            continue;
          }
        }
      }

      // Check missing QR data (captured via OCR/bulk but no QR code)
      if (!inv.kraQrCodeData && inv.captureMethod !== 'MANUAL') {
        drifts.push({
          ...base,
          driftType: 'MISSING_QR',
          detail: `Captured via ${inv.captureMethod} but no KRA QR code data stored`,
        });
      }
    }

    // Aggregate by type
    const byType: Record<string, number> = {};
    for (const d of drifts) {
      byType[d.driftType] = (byType[d.driftType] ?? 0) + 1;
    }

    this.logger.log(`[drift] report generated: ${drifts.length} drifts across ${invoices.length} invoices`);

    return {
      generatedAt: new Date().toISOString(),
      totalInvoices: invoices.length,
      driftCount: drifts.length,
      drifts,
      byType,
    };
  }
}
