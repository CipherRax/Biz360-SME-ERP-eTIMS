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
import { QuotationStatus, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { QuotationsService } from './quotations.service.js';
import {
  CreateQuotationDto,
  UpdateQuotationDto,
} from './dto/quotation.dto.js';

@ApiTags('quotations')
@ApiBearerAuth()
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(QuotationStatus, { optional: true })) status?: string,
    @Query('partyId', new ParseUUIDPipe({ optional: true })) partyId?: string,
  ) {
    return this.quotations.list(user.orgId, limit, cursor, search, status, partyId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.quotations.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Quotation')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateQuotationDto) {
    return this.quotations.createDraft(user.orgId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Quotation')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotations.updateDraft(user.orgId, id, dto, user.sub);
  }

  @Post(':id/send')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Quotation')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.quotations.send(user.orgId, id, user.sub);
  }

  @Post(':id/accept')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Quotation')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.quotations.accept(user.orgId, id, user.sub);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Quotation')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.quotations.cancel(user.orgId, id, user.sub);
  }

  @Post(':id/convert')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Quotation')
  convert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.quotations.convertToInvoice(user.orgId, id, user.sub);
  }
}