import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { EtimsReceipt } from './etims.client.js';
import { round2 } from '../../common/helpers/money.js';

type Tx = Prisma.TransactionClient;

type OrgLite = { taxPin: string | null; name: string };
type InvoiceLite = {
  id: string;
  orgId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  currency: string;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  etimsCtrlNo: string | null;
  lines: Array<{
    itemId: string | null;
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    lineAmount: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineDiscount: Prisma.Decimal;
  }>;
  party: {
    name: string;
    taxId: string | null;
    addressLine1: string | null;
    city: string | null;
  };
};

/**
 * Builds KRA E-TIMS invoice payloads (document types "0" sale and "2" credit
 * note) and persists the returned receipt on the document. The outbox handler
 * orchestrates loading → building → submitting → persisting.
 */
@Injectable()
export class EtimsService {
  buildSalePayload(org: OrgLite, deviceSerial: string, inv: InvoiceLite): Record<string, unknown> {
    return this.buildPayload(org, deviceSerial, inv, '0');
  }

  buildCreditPayload(org: OrgLite, deviceSerial: string, inv: InvoiceLite): Record<string, unknown> {
    return this.buildPayload(org, deviceSerial, inv, '2');
  }

  private buildPayload(
    org: OrgLite,
    deviceSerial: string,
    inv: InvoiceLite,
    invoiceType: '0' | '2',
  ): Record<string, unknown> {
    const d = new Date(inv.invoiceDate);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 19);

    const taxes = new Map<string, { rate: number; taxable: number; tax: number }>();
    for (const line of inv.lines) {
      const rate = Number(line.taxRate);
      const entry = taxes.get(String(rate)) ?? { rate, taxable: 0, tax: 0 };
      entry.taxable = round2(entry.taxable + Number(line.lineTotal));
      entry.tax = round2(entry.tax + Number(line.taxAmount));
      taxes.set(String(rate), entry);
    }

    return {
      Hdr: {
        PublicId: org.taxPin ?? '',
        DeviceSn: deviceSerial,
        BhfId: 'root',
        DvcSrlNo: deviceSerial,
        SdcId: inv.invoiceNumber,
        MhDt: date,
        MhTm: time,
      },
      SlsRcptDt: date,
      SlsRcptTm: time,
      InvcTyCd: invoiceType,
      SdcId: inv.invoiceNumber,
      CcyCd: inv.currency,
      TotInvcAmtNo: Number(inv.total),
      TotCdVatAmtNo: 0,
      TotVatNo: Number(inv.taxTotal),
      TotDcntAmtNo: Number(inv.discountTotal),
      RcptnDt: date,
      // Document type 2 (credit note) must reference the original control number.
      ...(invoiceType === '2' && inv.etimsCtrlNo ? { OrgInvcCtrlNo: inv.etimsCtrlNo } : {}),
      PartiesR: [
        {
          PtyCd: 1,
          Tin: inv.party.taxId ?? '',
          PtyNm: inv.party.name,
          Addr: inv.party.addressLine1 ? `${inv.party.addressLine1}${inv.party.city ? `, ${inv.party.city}` : ''}` : '',
        },
      ],
      ItemsR: inv.lines.map((line, i) => ({
        ItemSeq: i + 1,
        Cd: '1',
        Nm: line.description,
        Qty: Number(line.quantity),
        UprcUnitAmtNo: Number(line.unitPrice),
        TotDcntAmtNo: Number(line.lineDiscount),
        TotAmtNo: Number(line.lineTotal),
        VatAmtNo: Number(line.taxAmount),
      })),
      TaxPayableGroup: [...taxes.values()].map((t) => ({
        TaxTyCd: t.rate > 0 ? 'T' : 'O',
        TaxRteNo: t.rate,
        TaxblAmtNo: t.taxable,
        TaxAmtNo: t.tax,
      })),
    };
  }

  /** Persists the KRA receipt on the sale document (idempotent). */
  async recordReceipt(
    client: Tx,
    organizationId: string,
    saleInvoiceId: string,
    receipt: EtimsReceipt,
    type: '0' | '2',
  ): Promise<void> {
    if (type === '0') {
      await client.saleInvoice.updateMany({
        where: {
          id: saleInvoiceId,
          organizationId,
          etimsSubmittedAt: null,
        },
        data: {
          etimsCtrlNo: receipt.ctrlNo,
          etimsReceipt: receipt.receipt,
          etimsSubmittedAt: receipt.submittedAt,
        },
      });
      return;
    }
    await client.saleInvoice.updateMany({
      where: {
        id: saleInvoiceId,
        organizationId,
        etimsCreditSubmittedAt: null,
      },
      data: {
        etimsCreditCtrlNo: receipt.ctrlNo,
        etimsCreditReceipt: receipt.receipt,
        etimsCreditSubmittedAt: receipt.submittedAt,
      },
    });
  }
}