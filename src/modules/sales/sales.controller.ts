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
import { SalesService } from './sales.service.js';
import {
  CreateInvoiceDto,
  PaymentDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
} from './dto/invoice.dto.js';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('invoices')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(InvoiceStatus, { optional: true })) status?: string,
    @Query('partyId', new ParseUUIDPipe({ optional: true })) partyId?: string,
  ) {
    return this.sales.list(user.orgId, limit, cursor, search, status, partyId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.sales.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('SaleInvoice')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto) {
    return this.sales.createDraft(user.orgId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('SaleInvoice')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.sales.updateDraft(user.orgId, id, dto, user.sub);
  }

  @Post(':id/confirm')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('SaleInvoice')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.sales.confirmInvoice(user.orgId, id, user.sub);
  }

  @Post(':id/void')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('SaleInvoice')
  void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    return this.sales.voidInvoice(user.orgId, id, dto, user.sub);
  }

  @Post('payments')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Payment')
  recordPayment(@CurrentUser() user: AuthenticatedUser, @Body() dto: PaymentDto) {
    return this.sales.recordPayment(user.orgId, dto, user.sub);
  }
}