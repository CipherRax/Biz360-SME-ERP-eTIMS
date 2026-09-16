import {
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
import { GoodsReceiptStatus, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';
import {
  ConfirmGoodsReceiptDto,
  CreateGoodsReceiptDto,
} from './dto/goods-receipt.dto.js';

@ApiTags('goods-receipts')
@ApiBearerAuth()
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(GoodsReceiptStatus, { optional: true }))
    status?: string,
    @Query('partyId', new ParseUUIDPipe({ optional: true })) partyId?: string,
    @Query('purchaseOrderId', new ParseUUIDPipe({ optional: true }))
    purchaseOrderId?: string,
  ) {
    return this.receipts.list(
      user.orgId,
      limit,
      cursor,
      search,
      status,
      partyId,
      purchaseOrderId,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.receipts.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('GoodsReceipt')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGoodsReceiptDto,
  ) {
    return this.receipts.createDraft(user.orgId, dto, user.sub);
  }

  @Post(':id/confirm')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('GoodsReceipt')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto?: ConfirmGoodsReceiptDto,
  ) {
    return this.receipts.confirm(user.orgId, id, dto, user.sub);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('GoodsReceipt')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.receipts.cancel(user.orgId, id, user.sub);
  }
}
