import {
  Body,
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
import { PurchaseOrderStatus, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import {
  CreatePurchaseOrderDto,
  RejectPurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto.js';

@ApiTags('purchase-orders')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(PurchaseOrderStatus, { optional: true })) status?: string,
    @Query('partyId', new ParseUUIDPipe({ optional: true })) partyId?: string,
  ) {
    return this.purchaseOrders.list(user.orgId, limit, cursor, search, status, partyId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchaseOrders.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseOrder')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(user.orgId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseOrder')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseOrders.update(user.orgId, id, dto, user.sub);
  }

  @Post(':id/submit')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseOrder')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchaseOrders.submit(user.orgId, id, user.sub);
  }

  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('PurchaseOrder')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchaseOrders.approve(user.orgId, id, user.sub);
  }

  @Post(':id/reject')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('PurchaseOrder')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectPurchaseOrderDto,
  ) {
    return this.purchaseOrders.reject(user.orgId, id, dto, user.sub);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseOrder')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchaseOrders.cancel(user.orgId, id, user.sub);
  }
}