import { describe, expect, it } from 'vitest';
import { EtimsService } from './etims.service.js';
import { Prisma } from '../../generated/prisma/client.js';

const org = { taxPin: 'P051234567A', name: 'Shop Ltd' };
const inv = {
  id: 'inv-1',
  orgId: 'org-1',
  invoiceNumber: 'INV-2026-000001',
  invoiceDate: new Date('2026-09-15T10:30:00Z'),
  currency: 'KES',
  subtotal: new Prisma.Decimal('20000'),
  discountTotal: new Prisma.Decimal('0'),
  taxTotal: new Prisma.Decimal('3200'),
  total: new Prisma.Decimal('23200'),
  etimsCtrlNo: null,
  lines: [
    {
      itemId: 'item-1',
      description: 'Oak Table',
      quantity: new Prisma.Decimal('2'),
      unitPrice: new Prisma.Decimal('10000'),
      taxRate: new Prisma.Decimal('16'),
      lineAmount: new Prisma.Decimal('20000'),
      lineTotal: new Prisma.Decimal('20000'),
      taxAmount: new Prisma.Decimal('3200'),
      lineDiscount: new Prisma.Decimal('0'),
    },
  ],
  party: {
    name: 'Sarina Traders',
    taxId: 'P000000000C',
    addressLine1: 'Nairobi CBD',
    city: 'Nairobi',
  },
};

describe('EtimsService payload building', () => {
  const service = new EtimsService();

  interface Payload {
    Hdr: { PublicId: string; DeviceSn: string; DvcSrlNo: string; SdcId: string };
    InvcTyCd: '0' | '2';
    CcyCd: string;
    TotInvcAmtNo: number;
    TotVatNo: number;
    OrgInvcCtrlNo?: string;
    ItemsR: Array<{ ItemSeq: number; Nm: string; Qty: number }>;
    TaxPayableGroup: Array<{
      TaxTyCd: 'T' | 'O';
      TaxRteNo: number;
      TaxblAmtNo: number;
      TaxAmtNo: number;
    }>;
    PartiesR: Array<{ Tin: string; PtyNm: string }>;
  }

  it('builds a type-0 sale payload with KRA field names and grouping', () => {
    const p = service.buildSalePayload(org, 'DEV-1234', inv as never) as unknown as Payload;
    expect(p.Hdr.PublicId).toBe('P051234567A');
    expect(p.Hdr.DeviceSn).toBe('DEV-1234');
    expect(p.Hdr.DvcSrlNo).toBe('DEV-1234');
    expect(p.Hdr.SdcId).toBe('INV-2026-000001');
    expect(p.InvcTyCd).toBe('0');
    expect(p.CcyCd).toBe('KES');
    expect(Number(p.TotInvcAmtNo)).toBe(23200);
    expect(Number(p.TotVatNo)).toBe(3200);
    expect(p.ItemsR).toHaveLength(1);
    expect(p.ItemsR[0].Nm).toBe('Oak Table');
    expect(p.ItemsR[0].Qty).toBe(2);
    expect(p.TaxPayableGroup).toEqual([
      { TaxTyCd: 'T', TaxRteNo: 16, TaxblAmtNo: 20000, TaxAmtNo: 3200 },
    ]);
    expect(p.PartiesR[0]).toMatchObject({ Tin: 'P000000000C', PtyNm: 'Sarina Traders' });
    expect(p.OrgInvcCtrlNo).toBeUndefined();
  });

  it('builds a type-2 credit-note payload referencing the original control number', () => {
    const p = service.buildCreditPayload(org, 'DEV-1234', {
      ...inv,
      etimsCtrlNo: 'AAA000123',
    } as never) as unknown as Payload;
    expect(p.InvcTyCd).toBe('2');
    expect(p.OrgInvcCtrlNo).toBe('AAA000123');
  });

  it('groups per tax rate and treats zero-rate items as Other', () => {
    const p = service.buildSalePayload(org, 'DEV', {
      ...inv,
      lines: [
        { ...inv.lines[0], taxRate: new Prisma.Decimal('0'), taxAmount: new Prisma.Decimal('0') },
        { ...inv.lines[0], description: 'Second', taxRate: new Prisma.Decimal('16') },
      ],
    } as never) as unknown as Payload;
    expect(p.TaxPayableGroup).toHaveLength(2);
    expect(p.TaxPayableGroup[0].TaxTyCd).toBe('O');
    expect(p.TaxPayableGroup[1].TaxTyCd).toBe('T');
    expect(p.ItemsR).toHaveLength(2);
    expect(p.ItemsR[0].ItemSeq).toBe(1);
    expect(p.ItemsR[1].ItemSeq).toBe(2);
  });
});