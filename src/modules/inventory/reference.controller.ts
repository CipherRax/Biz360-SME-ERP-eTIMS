import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { InventoryService } from './inventory.service.js';
import { CreateCategoryDto, CreateUnitOfMeasureDto } from './dto/reference.dto.js';

@ApiTags('inventory')
@Controller('items/categories')
export class ItemCategoriesController {
  constructor(private readonly inventory: InventoryService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @ApiBearerAuth()
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.inventory.listCategories(user.orgId);
  }

  @ApiBearerAuth()
  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('ItemCategory')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    this.require(user);
    return this.inventory.createCategory(user.orgId, dto);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('ItemCategory')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    await this.inventory.removeCategory(user.orgId, id);
  }
}

@ApiTags('inventory')
@Controller('items/units')
export class UnitsOfMeasureController {
  constructor(private readonly inventory: InventoryService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @ApiBearerAuth()
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.inventory.listUnits(user.orgId);
  }

  @ApiBearerAuth()
  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('UnitOfMeasure')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUnitOfMeasureDto) {
    this.require(user);
    return this.inventory.createUnit(user.orgId, dto);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('UnitOfMeasure')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    await this.inventory.removeUnit(user.orgId, id);
  }
}