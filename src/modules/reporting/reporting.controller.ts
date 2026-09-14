import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
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