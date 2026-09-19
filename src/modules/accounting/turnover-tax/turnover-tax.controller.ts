import { BadRequestException, Body, Controller, Get, Post, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { Audit } from '../../../common/decorators/audit.decorator.js';
import { TurnoverTaxService } from './turnover-tax.service.js';
import { ListTotPeriodsDto, PayTotPeriodDto, UpdateTaxProfileDto } from './dto/tax-profile.dto.js';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/tax-profile')
export class TaxProfileController {
  constructor(private readonly service: TurnoverTaxService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Get()
  profile(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.service.profile(user.orgId);
  }

  @Put()
  @Roles(Role.ADMIN)
  @Audit('OrganizationTaxProfile')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTaxProfileDto) {
    this.require(user);
    return this.service.updateProfile(user.orgId, dto);
  }
}

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting/tot')
export class TotController {
  constructor(private readonly service: TurnoverTaxService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Get('periods')
  periods(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTotPeriodsDto,
  ) {
    this.require(user);
    return this.service.listPeriods(user.orgId, {
      from: query.from,
      to: query.to,
    });
  }

  @Post('periods/:id/pay')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('TotFilingPeriod')
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PayTotPeriodDto,
  ) {
    this.require(user);
    return this.service.payPeriod(user.orgId, id, dto);
  }

  @Get('periods/:id/receipt')
  receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    return this.service.receipt(user.orgId, id);
  }
}