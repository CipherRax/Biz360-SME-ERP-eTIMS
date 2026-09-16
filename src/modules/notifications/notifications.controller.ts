import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationStatus } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('status', new ParseEnumPipe(NotificationStatus, { optional: true }))
    status?: NotificationStatus,
  ) {
    this.require(user);
    return this.notifications.list(user.orgId, limit, cursor, status);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.notifications.unreadCount(user.orgId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    return this.notifications.findOne(user.orgId, id);
  }

  @Patch(':id/read')
  @Audit('Notification')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    return this.notifications.markRead(user.orgId, id);
  }

  @Post('read-all')
  @Audit('Notification')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.notifications.markAllRead(user.orgId);
  }
}