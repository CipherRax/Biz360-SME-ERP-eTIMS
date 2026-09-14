import {
  BadRequestException,
  Controller,
  Get,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StockMovementType } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/stock')
export class StockController {
  constructor(private readonly inventory: InventoryService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('categoryId', new ParseUUIDPipe({ optional: true })) categoryId?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit? : number,
  ) {
    this.require(user);
    return this.inventory.stockSummary(user.orgId, categoryId, limit ?? 200);
  }

  @Get('movements')
  movements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('itemId', new ParseUUIDPipe({ optional: true })) itemId?: string,
    @Query('type', new ParseEnumPipe(StockMovementType, { optional: true })) type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 100,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.inventory.allMovements(user.orgId, { itemId, type, from, to }, limit, cursor);
  }
}