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
import { InvoiceStatus, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { PurchasingService } from './purchasing.service.js';
import {
  CreatePurchaseDto,
  PurchasePaymentDto,
  UpdatePurchaseDto,
  VoidPurchaseDto,
} from './dto/purchase.dto.js';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchase-invoices')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(InvoiceStatus, { optional: true })) status?: string,
    @Query('partyId', new ParseUUIDPipe({ optional: true })) partyId?: string,
  ) {
    return this.purchasing.list(user.orgId, limit, cursor, search, status, partyId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchasing.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseInvoice')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseDto) {
    return this.purchasing.createDraft(user.orgId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseInvoice')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchasing.updateDraft(user.orgId, id, dto, user.sub);
  }

  @Post(':id/confirm')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseInvoice')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.purchasing.confirmPurchase(user.orgId, id, user.sub);
  }

  @Post(':id/void')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('PurchaseInvoice')
  void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidPurchaseDto,
  ) {
    return this.purchasing.voidPurchase(user.orgId, id, dto, user.sub);
  }

  @Post('payments')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Payment')
  recordPayment(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchasePaymentDto) {
    return this.purchasing.recordPayment(user.orgId, dto, user.sub);
  }
}