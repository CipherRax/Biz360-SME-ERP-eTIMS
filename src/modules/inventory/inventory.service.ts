import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemDto } from './dto/item.dto.js';
import { CreateCategoryDto, CreateUnitOfMeasureDto } from './dto/reference.dto.js';
import { AdjustStockDto } from './dto/stock.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { round2, sum } from '../../common/helpers/money.js';

const ITEM_SAFE_FIELDS = {
  id: true,
  name: true,
  sku: true,
  description: true,
  categoryId: true,
  baseUnit: true,
  buyPrice: true,
  sellPrice: true,
  taxCode: true,
  stockOnHand: true,
  trackStock: true,
  reorderLevel: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CATEGORY_SAFE_FIELDS = {
  id: true,
  name: true,
  description: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const UNIT_SAFE_FIELDS = {
  id: true,
  name: true,
  symbol: true,
  createdAt: true,
} as const;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------- items -------------------------------------

  listItems(
    organizationId: string,
    limit: number,
    cursor?: string,
    search?: string,
    active?: boolean,
  ) {
    return this.prisma.client.item.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(active !== undefined ? { active } : {}),
      },
      select: ITEM_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findItem(organizationId: string, itemId: string) {
    const item = await this.prisma.client.item.findFirst({
      where: { id: itemId, organizationId },
      select: ITEM_SAFE_FIELDS,
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async createItem(organizationId: string, dto: ItemDto) {
    if (dto.sku) {
      const dup = await this.prisma.client.item.findFirst({
        where: { organizationId, sku: dto.sku },
        select: { id: true },
      });
      if (dup) throw new ConflictException('SKU already exists in this organization');
    }
    return this.prisma.client.item.create({
      data: {
        organizationId,
        name: dto.name ?? '',
        sku: dto.sku ?? null,
        description: dto.description ?? null,
        categoryId: dto.categoryId ?? null,
        baseUnit: dto.baseUnit ?? 'pcs',
        buyPrice: dto.buyPrice ?? null,
        sellPrice: dto.sellPrice ?? null,
        taxCode: dto.taxCode ?? null,
        reorderLevel: dto.reorderLevel ?? null,
        active: dto.active ?? true,
        ...(dto.trackStock !== undefined ? { trackStock: dto.trackStock } : {}),
      },
      select: ITEM_SAFE_FIELDS,
    });
  }

  async updateItem(organizationId: string, itemId: string, dto: ItemDto) {
    const existing = await this.prisma.client.item.findFirst({
      where: { id: itemId, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Item not found');

    if (dto.sku) {
      const dup = await this.prisma.client.item.findFirst({
        where: { organizationId, sku: dto.sku, id: { not: itemId } },
        select: { id: true },
      });
      if (dup) throw new ConflictException('SKU already exists in this organization');
    }

    return this.prisma.client.item.update({
      where: { id: itemId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.baseUnit !== undefined ? { baseUnit: dto.baseUnit } : {}),
        ...(dto.buyPrice !== undefined ? { buyPrice: dto.buyPrice } : {}),
        ...(dto.sellPrice !== undefined ? { sellPrice: dto.sellPrice } : {}),
        ...(dto.taxCode !== undefined ? { taxCode: dto.taxCode } : {}),
        ...(dto.reorderLevel !== undefined ? { reorderLevel: dto.reorderLevel } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.trackStock !== undefined ? { trackStock: dto.trackStock } : {}),
      },
      select: ITEM_SAFE_FIELDS,
    });
  }

  async removeItem(organizationId: string, itemId: string): Promise<void> {
    const existing = await this.prisma.client.item.findFirst({
      where: { id: itemId, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Item not found');
    // Logical delete; the extension filters deleted rows from all reads.
    await this.prisma.client.item.update({
      where: { id: itemId },
      data: { deletedAt: new Date() },
    });
  }

  // --------------------------- categories -----------------------------------

  listCategories(organizationId: string) {
    return this.prisma.client.itemCategory.findMany({
      where: { organizationId },
      select: CATEGORY_SAFE_FIELDS,
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(organizationId: string, dto: CreateCategoryDto) {
    const dup = await this.prisma.client.itemCategory.findFirst({
      where: { organizationId, name: dto.name },
      select: { id: true },
    });
    if (dup) throw new ConflictException('Category name already exists');
    return this.prisma.client.itemCategory.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description ?? null,
      },
      select: CATEGORY_SAFE_FIELDS,
    });
  }

  async removeCategory(organizationId: string, categoryId: string): Promise<void> {
    const existing = await this.prisma.client.itemCategory.findFirst({
      where: { id: categoryId, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Category not found');
    // Soft delete keeps historical items linked; only name uniqueness could
    // collide on re-create, which the service guards.
    await this.prisma.client.itemCategory.update({
      where: { id: categoryId },
      data: { deletedAt: new Date(), active: false },
    });
  }

  // --------------------------- units of measure -----------------------------

  listUnits(organizationId: string) {
    return this.prisma.client.unitOfMeasure.findMany({
      where: { organizationId },
      select: UNIT_SAFE_FIELDS,
      orderBy: { symbol: 'asc' },
    });
  }

  async createUnit(organizationId: string, dto: CreateUnitOfMeasureDto) {
    const dup = await this.prisma.client.unitOfMeasure.findFirst({
      where: { organizationId, symbol: dto.symbol },
      select: { id: true },
    });
    if (dup) throw new ConflictException('Unit symbol already exists');
    return this.prisma.client.unitOfMeasure.create({
      data: { organizationId, name: dto.name, symbol: dto.symbol },
      select: UNIT_SAFE_FIELDS,
    });
  }

  async removeUnit(organizationId: string, unitId: string): Promise<void> {
    const existing = await this.prisma.client.unitOfMeasure.findFirst({
      where: { id: unitId, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Unit of measure not found');
    await this.prisma.client.unitOfMeasure.update({
      where: { id: unitId },
      data: { deletedAt: new Date() },
    });
  }

  // ----------------------------- stock --------------------------------------

  /**
   * Adjust physical stock, recording an append-only StockMovement. A negative
   * quantity that would push stock below zero is rejected.
   */
  async adjustStock(
    organizationId: string,
    itemId: string,
    dto: AdjustStockDto,
    userId: string,
    type: 'ADJUSTMENT' = 'ADJUSTMENT',
  ) {
    const delta = Number.parseFloat(dto.quantity);
    if (!Number.isFinite(delta) || delta === 0) {
      throw new ConflictException('Stock adjustment quantity must be a non-zero number');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId },
        select: { id: true, stockOnHand: true, trackStock: true },
      });
      if (!item) throw new NotFoundException('Item not found');

      const onHand = Number(item.stockOnHand);
      const newOnHand = onHand + delta;
      if (newOnHand < 0) {
        throw new ConflictException(
          `Insufficient stock: on hand ${onHand}, adjustment ${delta} would leave ${newOnHand}`,
        );
      }

      const movement = await tx.stockMovement.create({
        data: {
          organizationId,
          itemId,
          quantity: delta.toString(),
          type,
          reason: dto.reason ?? null,
          userId,
        },
        select: { id: true, quantity: true, type: true, reason: true, createdAt: true },
      });

      const updated = await tx.item.update({
        where: { id: itemId },
        data: { stockOnHand: newOnHand.toString() },
        select: { stockOnHand: true },
      });

      return { movement, stockOnHand: updated.stockOnHand };
    });
  }

  stockMovements(
    organizationId: string,
    itemId: string,
    limit: number,
    cursor?: string,
  ) {
    return this.prisma.client.stockMovement.findMany({
      where: { organizationId, itemId },
      select: {
        id: true,
        quantity: true,
        type: true,
        reason: true,
        referenceId: true,
        userId: true,
        createdAt: true,
      },
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  /* -------------------------- stock reporting ----------------------------- */
  /* ----------------------------------------------------------------------- */
  /*  Stock summary with valuation                                           */
  /*  ---------------------------------------------------------------------- */

  async stockSummary(
    organizationId: string,
    categoryId?: string,
    limit = 200,
  ) {
    const items = await this.prisma.client.item.findMany({
      where: {
        organizationId,
        ...(categoryId ? { categoryId } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        categoryId: true,
        buyPrice: true,
        sellPrice: true,
        stockOnHand: true,
        reorderLevel: true,
        active: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      take: Math.min(limit, 1000),
    });

    // Weighted-average unit cost from confirmed purchases (fallback when
    // buyPrice is unset).
    const itemIds = items.map((i) => i.id);
    const purchaseLines = itemIds.length
      ? await this.prisma.client.purchaseInvoiceLine.findMany({
          where: {
            organizationId,
            itemId: { in: itemIds, not: null },
            invoice: {
              status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
            },
          },
          select: { itemId: true, quantity: true, unitPrice: true },
        })
      : [];
    const costByItem = new Map<string, number>();
    const qtyByItem = new Map<string, number>();
    for (const pl of purchaseLines) {
      const itemId = pl.itemId;
      if (!itemId) continue;
      const qty = Number(pl.quantity);
      costByItem.set(itemId, (costByItem.get(itemId) ?? 0) + qty * Number(pl.unitPrice));
      qtyByItem.set(itemId, (qtyByItem.get(itemId) ?? 0) + qty);
    }
    const unitCostOf = (item: (typeof items)[number]): number => {
      if (item.buyPrice != null) return Number(item.buyPrice);
      const qty = qtyByItem.get(item.id) ?? 0;
      if (qty > 0) return round2((costByItem.get(item.id) ?? 0) / qty);
      return item.buyPrice != null ? Number(item.buyPrice) : 0;
    };

    const lines = items.map((item) => {
      const stockOnHand = Number(item.stockOnHand);
      const unitCost = unitCostOf(item);
      return {
        itemId: item.id,
        name: item.name,
        sku: item.sku,
        category: item.category?.name ?? null,
        stockOnHand,
        unitCost,
        valuation: round2(stockOnHand * unitCost),
        reorderLevel: Number(item.reorderLevel ?? 0),
        lowStock: item.stockOnHand != null && stockOnHand <= Number(item.reorderLevel ?? 0),
      };
    });

    return {
      items: lines,
      totals: {
        items: lines.length,
        units: sum(lines.map((l) => l.stockOnHand)),
        valuation: sum(lines.map((l) => l.valuation)),
      },
    };
  }

  /* ----------------------------------------------------------------------- */
  /*  Movement report (across all items, optionally filtered)                 */
  /* ----------------------------------------------------------------------- */

  allMovements(
    organizationId: string,
    filters: {
      itemId?: string;
      type?: string;
      from?: string;
      to?: string;
    },
    limit: number,
    cursor?: string,
  ) {
    const where: Record<string, unknown> = { organizationId };
    if (filters.itemId) where.itemId = filters.itemId;
    if (filters.type) where.type = filters.type;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    return this.prisma.client.stockMovement.findMany({
      where,
      select: {
        id: true,
        itemId: true,
        item: { select: { id: true, name: true, sku: true } },
        quantity: true,
        type: true,
        reason: true,
        referenceId: true,
        userId: true,
        createdAt: true,
      },
      take: Math.min(limit, 200),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }
}