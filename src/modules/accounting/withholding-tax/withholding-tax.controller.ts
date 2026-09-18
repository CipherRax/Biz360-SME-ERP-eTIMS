import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { Audit } from '../../../common/decorators/audit.decorator.js';
import { WithholdingTaxService } from './withholding-tax.service.js';
import {
  UpsertWithholdingTaxRateDto,
  ComputeWithholdingTaxDto,
  RecordWithholdingTaxDto,
  ListWithholdingTaxDeductionsDto,
  WithholdingTaxCertificateDto,
  CalculateWithholdingTaxDto,
} from './dto/withholding-tax.dto.js';

@ApiTags('withholding-tax')
@ApiBearerAuth()
@Controller('withholding-tax')
export class WithholdingTaxController {
  constructor(private readonly service: WithholdingTaxService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @Get('rates')
  listRates(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.service.listRates(user.orgId);
  }

  @Get('payments')
  eligiblePayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    this.require(user);
    return this.service.eligiblePayments(user.orgId, limit);
  }

  @Post('rates')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @Audit('WithholdingTaxRate')
  upsertRate(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertWithholdingTaxRateDto) {
    this.require(user);
    return this.service.upsertRate(user.orgId, dto);
  }

  /** Scenario preview before finalizing a payment. */
  @Post('compute')
  compute(@CurrentUser() user: AuthenticatedUser, @Body() dto: ComputeWithholdingTaxDto) {
    this.require(user);
    return this.service.compute(user.orgId, dto);
  }

  @Post('record')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  @Audit('WithholdingTaxDeduction')
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordWithholdingTaxDto) {
    this.require(user);
    return this.service.record(user.orgId, dto);
  }

  @Get('deductions')
  list(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListWithholdingTaxDeductionsDto) {
    this.require(user);
    return this.service.list(user.orgId, dto);
  }

  @Get('certificate')
  certificate(@CurrentUser() user: AuthenticatedUser, @Query() dto: WithholdingTaxCertificateDto) {
    this.require(user);
    return this.service.certificate(user.orgId, dto);
  }

  @Get('remittance-summary')
  remittanceSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: CalculateWithholdingTaxDto,
  ) {
    this.require(user);
    return this.service.remittanceSummary(user.orgId, dto);
  }
}