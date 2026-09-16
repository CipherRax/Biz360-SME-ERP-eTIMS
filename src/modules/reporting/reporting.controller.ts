import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { ReportingService } from './reporting.service.js';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  /** Daily sales totals for a date range (default: current month). */
  @Get('sales/summary')
  salesSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reporting.salesSummary(user.orgId, from, to);
  }

  /** Open receivables by customer. */
  @Get('receivables')
  receivables(@CurrentUser() user: AuthenticatedUser) {
    return this.reporting.receivables(user.orgId);
  }

  /** Open payables by supplier. */
  @Get('payables')
  payables(@CurrentUser() user: AuthenticatedUser) {
    return this.reporting.payables(user.orgId);
  }

  /** Aged receivables by customer (30/60/90-day buckets). */
  @Get('receivables/aged')
  agedReceivables(@CurrentUser() user: AuthenticatedUser) {
    return this.reporting.agedReceivables(user.orgId);
  }

  /** Aged payables by supplier (30/60/90-day buckets). */
  @Get('payables/aged')
  agedPayables(@CurrentUser() user: AuthenticatedUser) {
    return this.reporting.agedPayables(user.orgId);
  }

  /** Period-based VAT summary. */
  @Get('tax-summary')
  taxSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reporting.taxSummary(user.orgId, startDate, endDate);
  }

  /** Top-selling items over a period. */
  @Get('top-items')
  topItems(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.reporting.topItems(user.orgId, from, to, limit ?? 10);
  }

  /** Combined dashboard KPIs. */
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.reporting.dashboard(user.orgId);
  }
}
