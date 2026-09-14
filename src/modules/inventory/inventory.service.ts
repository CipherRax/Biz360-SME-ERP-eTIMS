import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemDto } from './dto/item.dto.js';
import { CreateCategoryDto, CreateUnitOfMeasureDto } from './dto/reference.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';

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
}