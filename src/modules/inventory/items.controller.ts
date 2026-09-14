import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { InventoryService } from './inventory.service.js';
import { ItemDto } from './dto/item.dto.js';
import { AdjustStockDto } from './dto/stock.dto.js';

@ApiTags('inventory')
@Controller('items')
export class ItemsController {
  constructor(private readonly inventory: InventoryService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @ApiBearerAuth()
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('active', new ParseBoolPipe({ optional: true })) active?: boolean,
  ) {
    this.require(user);
    return this.inventory.listItems(user.orgId, limit, cursor, search, active);
  }

  @ApiBearerAuth()
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    return this.inventory.findItem(user.orgId, id);
  }

  @ApiBearerAuth()
  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('Item')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: ItemDto) {
    this.require(user);
    return this.inventory.createItem(user.orgId, dto);
  }

  @ApiBearerAuth()
  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('Item')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ItemDto,
  ) {
    this.require(user);
    return this.inventory.updateItem(user.orgId, id, dto);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('Item')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    await this.inventory.removeItem(user.orgId, id);
  }

  @Post(':id/stock')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('StockMovement')
  adjustStock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdjustStockDto,
  ) {
    this.require(user);
    return this.inventory.adjustStock(user.orgId, id, dto, user.sub);
  }

  @Get(':id/stock/movements')
  movements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.inventory.stockMovements(user.orgId, id, limit, cursor);
  }
}