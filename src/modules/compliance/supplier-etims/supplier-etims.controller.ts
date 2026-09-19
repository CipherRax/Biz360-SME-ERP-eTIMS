import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupplierEtimsMatchStatus } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { Audit } from '../../../common/decorators/audit.decorator.js';
import { SupplierEtimsService } from './supplier-etims.service.js';
import {
  CreateSupplierEtimsCreditNoteDto,
  CreateSupplierEtimsInvoiceDto,
  MatchSupplierEtimsCreditNoteDto,
  MatchSupplierEtimsDto,
  ScanSupplierEtimsDto,
} from './dto/supplier-etims.dto.js';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('etims/supplier-invoices')
export class SupplierEtimsController {
  constructor(private readonly service: SupplierEtimsService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Post()
  @Audit('SupplierEtimsInvoice')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierEtimsInvoiceDto) {
    this.require(user);
    return this.service.create(user.orgId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('supplierId', new ParseUUIDPipe({ optional: true })) supplierId?: string,
    @Query('matchStatus', new ParseEnumPipe(SupplierEtimsMatchStatus, { optional: true }))
    matchStatus?: SupplierEtimsMatchStatus,
  ) {
    this.require(user);
    return this.service.list(user.orgId, { limit, cursor, supplierId, matchStatus });
  }

  @Post('scan')
  scan(@CurrentUser() user: AuthenticatedUser, @Body() dto: ScanSupplierEtimsDto) {
    this.require(user);
    return this.service.scan(user.orgId, dto);
  }

  @Get('scan/:jobId')
  scanStatus(@CurrentUser() user: AuthenticatedUser, @Param('jobId') jobId: string) {
    this.require(user);
    return this.service.scanStatus(user.orgId, jobId);
  }

  @Post(':id/verify')
  @Audit('SupplierEtimsInvoice')
  verify(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.require(user);
    return this.service.verify(user.orgId, id);
  }

  @Post(':id/match')
  @Audit('SupplierEtimsInvoice')
  match(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MatchSupplierEtimsDto,
  ) {
    this.require(user);
    return this.service.match(user.orgId, id, dto);
  }

  @Get('unmatched')
  unmatched(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.service.unmatched(user.orgId, limit, cursor);
  }

  // ---- Bulk upload (ETR XML) ----

  @Post('upload')
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { filename: string; xml: string },
  ) {
    this.require(user);
    if (!body.xml) throw new BadRequestException('xml body is required');
    return this.service.createUpload(user.orgId, body.filename ?? 'upload.xml', body.xml);
  }

  @Get('upload')
  listUploads(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.service.listUploads(user.orgId, limit, cursor);
  }

  @Get('upload/:id')
  getUpload(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.require(user);
    return this.service.getUpload(user.orgId, id);
  }

  @Get('upload/:id/items')
  getUploadItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 100,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.service.getUploadItems(user.orgId, id, limit, cursor);
  }

  @Post('upload/:id/retry')
  @Audit('SupplierEtimsUpload')
  retryUpload(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.require(user);
    return this.service.retryUpload(user.orgId, id);
  }
}

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('etims/compliance')
export class ExpenseExposureController {
  constructor(private readonly service: SupplierEtimsService) {}

  @Get('exposure-summary')
  exposure(@CurrentUser() user: AuthenticatedUser) {
    if (!user) throw new BadRequestException('Not authenticated');
    return this.service.exposureSummary(user.orgId);
  }

  @Get('reconciliation')
  reconciliation(@CurrentUser() user: AuthenticatedUser) {
    if (!user) throw new BadRequestException('Not authenticated');
    return this.service.reconciliation(user.orgId);
  }
}

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('etims/supplier-credit-notes')
export class SupplierEtimsCreditController {
  constructor(private readonly service: SupplierEtimsService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Post()
  @Audit('SupplierEtimsCreditNote')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierEtimsCreditNoteDto) {
    this.require(user);
    return this.service.createCreditNote(user.orgId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('supplierId', new ParseUUIDPipe({ optional: true })) supplierId?: string,
    @Query('matchStatus', new ParseEnumPipe(SupplierEtimsMatchStatus, { optional: true }))
    matchStatus?: SupplierEtimsMatchStatus,
  ) {
    this.require(user);
    return this.service.listCreditNotes(user.orgId, { limit, cursor, supplierId, matchStatus });
  }

  @Get('unmatched')
  unmatched(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.service.unmatchedCreditNotes(user.orgId, limit, cursor);
  }

  @Post(':id/verify')
  @Audit('SupplierEtimsCreditNote')
  verify(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.require(user);
    return this.service.verifyCreditNote(user.orgId, id);
  }

  @Post(':id/match')
  @Audit('SupplierEtimsCreditNote')
  match(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MatchSupplierEtimsCreditNoteDto,
  ) {
    this.require(user);
    return this.service.matchCreditNote(user.orgId, id, dto);
  }
}