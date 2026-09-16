import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
  StockMovementType,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toAmount } from '../../common/helpers/money.js';
import {
  ConfirmGoodsReceiptDto,
  CreateGoodsReceiptDto,
} from './dto/goods-receipt.dto.js';

/* -------------------------------------------------------------------------- */
/*  Safe field projections                                                    */
/* -------------------------------------------------------------------------- */

const GRN_LINES = {
  id: true,
  poLineId: true,
  itemId: true,
  item: { select: { id: true, name: true } },
  description: true,
  quantity: true,
  notes: true,
} as const;

const GRN_SAFE_FIELDS = {
  id: true,
  grnNumber: true,
  purchaseOrderId: true,
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  partyId: true,
  party: { select: { id: true, name: true } },
  receivedDate: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
} as const;

const RECEIPT_DETAILS = {
  lines: { orderBy: { id: 'asc' }, select: GRN_LINES },
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  party: { select: { id: true, name: true, taxId: true } },
} as const;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Validates a received quantity (positive, numeric) and preserves full 3-dp scale. */
function toQty(value: string | number | Prisma.Decimal): Prisma.Decimal {
  let n: number;
  try {
    n = toAmount(value.toString());
  } catch (err) {
    throw new BadRequestException(
      `Invalid quantity: ${(err as Error).message}`,
    );
  }
  if (!(n > 0)) {
    throw new BadRequestException('Quantity must be a positive number');
  }
  return new Prisma.Decimal(value.toString());
}

/* -------------------------------------------------------------------------- */
/*  Service                                                                   */
/* -------------------------------------------------------------------------- */

@Injectable()
export class GoodsReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  private async allocateNumber(
    organizationId: string,
    client: Prisma.TransactionClient,
  ): Promise<string> {
    const seq = await client.goodsReceiptNumberSeq.upsert({
      where: { organizationId },
      create: { organizationId, value: 1 },
      update: { value: { increment: 1 } },
    });
    const year = new Date().getFullYear();
    return `GRN-${year}-${String(seq.value).padStart(6, '0')}`;
  }

  /* ----------------------------------------------------------------------- */
  /*  Create (DRAFT against an APPROVED purchase order)                       */
  /* ----------------------------------------------------------------------- */

  async createDraft(
    organizationId: string,
    dto: CreateGoodsReceiptDto,
    userId: string,
  ) {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, organizationId },
      select: {
        id: true,
        poNumber: true,
        partyId: true,
        status: true,
        lines: { select: { id: true, itemId: true, description: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.APPROVED) {
      throw new BadRequestException(
        `Goods receipts can only be created against an approved purchase order (PO ${po.poNumber} is ${po.status})`,
      );
    }

    const poLineMap = new Map(po.lines.map((l) => [l.id, l]));
    for (const line of dto.lines) {
      if (!poLineMap.has(line.poLineId)) {
        throw new BadRequestException(
          `Purchase order line ${line.poLineId} does not belong to purchase order ${po.poNumber}`,
        );
      }
      toQty(line.quantity);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const grnNumber = await this.allocateNumber(organizationId, tx);
      return tx.goodsReceipt.create({
        data: {
          organizationId,
          grnNumber,
          purchaseOrderId: dto.purchaseOrderId,
          partyId: po.partyId,
          receivedDate: dto.receivedDate
            ? new Date(dto.receivedDate)
            : new Date(),
          status: GoodsReceiptStatus.DRAFT,
          notes: dto.notes ?? null,
          createdBy: userId,
          updatedBy: userId,
          lines: {
            create: dto.lines.map((line) => {
              const poLine = poLineMap.get(line.poLineId)!;
              return {
                organizationId,
                poLineId: line.poLineId,
                itemId: poLine.itemId ?? null,
                description: poLine.description,
                quantity: toQty(line.quantity),
                notes: line.notes ?? null,
              };
            }),
          },
        },
        include: RECEIPT_DETAILS,
      });
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Confirm → stock in, PO line receivedQty, DRAFT → CONFIRMED (CAS)        */
  /* ----------------------------------------------------------------------- */

  async confirm(
    organizationId: string,
    receiptId: string,
    dto: ConfirmGoodsReceiptDto | undefined,
    userId: string,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.findFirst({
        where: { id: receiptId, organizationId },
        include: {
          lines: {
            select: { id: true, poLineId: true, itemId: true, quantity: true },
          },
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              lines: {
                select: {
                  id: true,
                  itemId: true,
                  description: true,
                  quantity: true,
                  receivedQty: true,
                },
              },
            },
          },
        },
      });
      if (!receipt) throw new NotFoundException('Goods receipt not found');
      if (receipt.status !== GoodsReceiptStatus.DRAFT) {
        throw new ConflictException(
          `Cannot confirm a goods receipt in ${receipt.status} status`,
        );
      }

      const poLineMap = new Map(
        receipt.purchaseOrder.lines.map((l) => [l.id, l]),
      );

      // Reject over-receipt before mutating stock or received quantities.
      for (const line of receipt.lines) {
        const poLine = poLineMap.get(line.poLineId);
        if (!poLine) {
          throw new BadRequestException(
            `Purchase order line ${line.poLineId} no longer belongs to purchase order ${receipt.purchaseOrder.poNumber}`,
          );
        }
        const qty = toQty(line.quantity);
        const received = new Prisma.Decimal(poLine.receivedQty.toString());
        const ordered = new Prisma.Decimal(poLine.quantity.toString());
        if (received.plus(qty).greaterThan(ordered)) {
          throw new BadRequestException(
            `Receiving ${qty} exceeds the outstanding quantity (${ordered.minus(received)}) for purchase order line ${poLine.description}`,
          );
        }
      }

      for (const line of receipt.lines) {
        const poLine = poLineMap.get(line.poLineId)!;
        const qty = toQty(line.quantity);

        if (line.itemId) {
          const item = await tx.item.findFirst({
            where: { id: line.itemId, organizationId },
            select: { id: true, trackStock: true },
          });
          if (item && item.trackStock) {
            await tx.item.update({
              where: { id: item.id },
              data: { stockOnHand: { increment: qty } },
            });
            await tx.stockMovement.create({
              data: {
                organizationId,
                itemId: item.id,
                quantity: qty,
                type: StockMovementType.PURCHASE_IN,
                referenceId: receiptId,
                userId,
              },
            });
          }
        }

        await tx.purchaseOrderLine.update({
          where: { id: poLine.id },
          data: { receivedQty: { increment: qty } },
        });
      }

      const cas = await tx.goodsReceipt.updateMany({
        where: {
          id: receiptId,
          organizationId,
          status: GoodsReceiptStatus.DRAFT,
        },
        data: {
          status: GoodsReceiptStatus.CONFIRMED,
          receivedDate: dto?.receivedDate
            ? new Date(dto.receivedDate)
            : undefined,
          notes: dto?.notes !== undefined ? dto.notes : undefined,
          updatedBy: userId,
        },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          `Cannot confirm a goods receipt in ${receipt.status} status`,
        );
      }

      return tx.goodsReceipt.findFirstOrThrow({
        where: { id: receiptId, organizationId },
        include: RECEIPT_DETAILS,
      });
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Cancel (DRAFT only)                                                     */
  /* ----------------------------------------------------------------------- */

  async cancel(organizationId: string, receiptId: string, userId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.findFirst({
        where: { id: receiptId, organizationId },
        select: { id: true, status: true },
      });
      if (!receipt) throw new NotFoundException('Goods receipt not found');
      if (receipt.status !== GoodsReceiptStatus.DRAFT) {
        throw new ConflictException(
          'Only draft goods receipts can be cancelled',
        );
      }

      const cas = await tx.goodsReceipt.updateMany({
        where: {
          id: receiptId,
          organizationId,
          status: GoodsReceiptStatus.DRAFT,
        },
        data: { status: GoodsReceiptStatus.CANCELLED, updatedBy: userId },
      });
      if (cas.count !== 1) {
        throw new ConflictException(
          'Goods receipt status changed concurrently; retry',
        );
      }

      return tx.goodsReceipt.findFirstOrThrow({
        where: { id: receiptId, organizationId },
        include: RECEIPT_DETAILS,
      });
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Read                                                                    */
  /* ----------------------------------------------------------------------- */

  list(
    organizationId: string,
    limit: number,
    cursor?: string,
    search?: string,
    status?: string,
    partyId?: string,
    purchaseOrderId?: string,
  ) {
    return this.prisma.client.goodsReceipt.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as GoodsReceiptStatus } : {}),
        ...(partyId ? { partyId } : {}),
        ...(purchaseOrderId ? { purchaseOrderId } : {}),
        ...(search
          ? {
              OR: [
                { grnNumber: { contains: search, mode: 'insensitive' } },
                {
                  purchaseOrder: {
                    poNumber: { contains: search, mode: 'insensitive' },
                  },
                },
                { party: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: GRN_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, receiptId: string) {
    const receipt = await this.prisma.client.goodsReceipt.findFirst({
      where: { id: receiptId, organizationId },
      include: RECEIPT_DETAILS,
    });
    if (!receipt) throw new NotFoundException('Goods receipt not found');
    return receipt;
  }
}
