import { Injectable, NotFoundException } from '@nestjs/common';
import {
  NotificationStatus,
  NotificationType,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateNotificationDto, UpdateNotificationDto } from './dto/notification.dto.js';

/** Low-stock notifications are not re-created for the same item in this window. */
const LOW_STOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

const NOTIFICATION_SAFE_FIELDS = {
  id: true,
  type: true,
  status: true,
  title: true,
  message: true,
  referenceType: true,
  referenceId: true,
  metadata: true,
  createdAt: true,
} as const;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a notification for an organization (internal, callable by other services). */
  create(organizationId: string, dto: CreateNotificationDto) {
    return this.prisma.client.notification.create({
      data: {
        organizationId,
        type: dto.type ?? NotificationType.CUSTOM,
        title: dto.title,
        message: dto.message ?? null,
        referenceType: dto.referenceType ?? null,
        referenceId: dto.referenceId ?? null,
        metadata: dto.metadata ?? undefined,
      },
      select: NOTIFICATION_SAFE_FIELDS,
    });
  }

  list(
    organizationId: string,
    limit: number,
    cursor?: string,
    status?: NotificationStatus,
  ) {
    return this.prisma.client.notification.findMany({
      where: {
        organizationId,
        ...(status ? { status } : {}),
      },
      select: NOTIFICATION_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findOne(organizationId: string, notificationId: string) {
    const notification = await this.prisma.client.notification.findFirst({
      where: { organizationId, id: notificationId },
      select: NOTIFICATION_SAFE_FIELDS,
    });
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async update(
    organizationId: string,
    notificationId: string,
    dto: UpdateNotificationDto,
  ) {
    await this.findOne(organizationId, notificationId);
    return this.prisma.client.notification.update({
      where: { id: notificationId },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.message !== undefined ? { message: dto.message } : {}),
        ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {}),
      },
      select: NOTIFICATION_SAFE_FIELDS,
    });
  }

  async markRead(organizationId: string, notificationId: string) {
    await this.findOne(organizationId, notificationId);
    return this.prisma.client.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.READ },
      select: NOTIFICATION_SAFE_FIELDS,
    });
  }

  async markAllRead(organizationId: string) {
    const { count } = await this.prisma.client.notification.updateMany({
      where: { organizationId, status: NotificationStatus.UNREAD },
      data: { status: NotificationStatus.READ },
    });
    return { count };
  }

  async unreadCount(organizationId: string) {
    const count = await this.prisma.client.notification.count({
      where: { organizationId, status: NotificationStatus.UNREAD },
    });
    return { count };
  }

  /**
   * Sweep items that fell to (or below) their reorder level and notify, once per
   * item per 24 hours. Runs unscoped, so it can be triggered from a scheduler or
   * from within a request (the tenant extension scopes the reads automatically).
   */
  async checkLowStock() {
    const since = new Date(Date.now() - LOW_STOCK_WINDOW_MS);
    const items = await this.prisma.client.item.findMany({
      where: { trackStock: true, reorderLevel: { not: null } },
      select: {
        id: true,
        name: true,
        organizationId: true,
        stockOnHand: true,
        reorderLevel: true,
      },
    });

    let created = 0;
    for (const item of items) {
      const reorderLevel = item.reorderLevel;
      if (reorderLevel == null || !item.stockOnHand.lte(reorderLevel)) continue;

      const existing = await this.prisma.client.notification.findFirst({
        where: {
          organizationId: item.organizationId,
          type: NotificationType.LOW_STOCK,
          referenceType: 'Item',
          referenceId: item.id,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (existing) continue;

      await this.prisma.client.notification.create({
        data: {
          organizationId: item.organizationId,
          type: NotificationType.LOW_STOCK,
          title: `Low stock: ${item.name}`,
          message: `Stock on hand (${item.stockOnHand.toString()}) is at or below the reorder level (${reorderLevel.toString()}).`,
          referenceType: 'Item',
          referenceId: item.id,
          metadata: {
            itemId: item.id,
            itemName: item.name,
            stockOnHand: item.stockOnHand.toString(),
            reorderLevel: reorderLevel.toString(),
          },
        },
      });
      created += 1;
    }
    return { created };
  }
}