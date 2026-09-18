import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartyStatus, PartyType, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { PartiesService } from './parties.service.js';
import { CreatePartyDto, UpdatePartyDto } from './dto/party.dto.js';

@ApiTags('parties')
@ApiBearerAuth()
@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  private require(
    user: AuthenticatedUser | undefined,
  ): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('type', new ParseEnumPipe(PartyType, { optional: true })) type?: PartyType,
    @Query('status', new ParseEnumPipe(PartyStatus, { optional: true })) status?: PartyStatus,
  ) {
    this.require(user);
    return this.parties.list(user.orgId, limit, cursor, search, type, status);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.require(user);
    return this.parties.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Party')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartyDto) {
    this.require(user);
    return this.parties.create(user.orgId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('Party')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePartyDto,
  ) {
    this.require(user);
    return this.parties.update(user.orgId, id, dto);
  }

  @Post(':id/kra-pin/verify')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @Audit('Party')
  verifyKraPin(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.require(user);
    return this.parties.verifyKraPin(user.orgId, id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('Party')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.require(user);
    await this.parties.remove(user.orgId, id);
  }
}