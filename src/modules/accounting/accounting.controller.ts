import {
  Body,
  Controller,
  Delete,
  Get,
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
import { AccountingService } from './accounting.service.js';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto.js';
import { CreateJournalEntryDto, ReverseJournalEntryDto } from './dto/journal-entry.dto.js';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  /* ----------------------------------------------------------------------- */
  /*  Accounts                                                                */
  /* ----------------------------------------------------------------------- */

  @Get('accounts')
  listAccounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('withBalances', new ParseBoolPipe({ optional: true })) withBalances?: string,
  ) {
    return this.accounting.listAccounts(user.orgId, {
      type,
      search,
      withBalances: withBalances === 'true',
    });
  }

  @Get('accounts/:id')
  accountDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.accounting.accountDetail(user.orgId, id);
  }

  @Post('accounts')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  createAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accounting.createAccount(user.orgId, dto, user.sub);
  }

  @Patch('accounts/:id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounting.updateAccount(user.orgId, id, dto, user.sub);
  }

  @Delete('accounts/:id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  removeAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.accounting.removeAccount(user.orgId, id);
  }

  /* ----------------------------------------------------------------------- */
  /*  Journal entries                                                         */
  /* ----------------------------------------------------------------------- */

  @Get('journal-entries')
  listEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.accounting.listEntries(user.orgId, {
      limit,
      cursor,
      status,
      sourceType,
      from,
      to,
    });
  }

  @Get('journal-entries/:id')
  getEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.accounting.getEntry(user.orgId, id);
  }

  @Post('journal-entries')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  createEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.accounting.createEntry(user.orgId, dto, user.sub);
  }

  @Post('journal-entries/:id/approve')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  approveEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.accounting.approveEntry(user.orgId, id, user.sub);
  }

  @Post('journal-entries/:id/reverse')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  reverseEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseJournalEntryDto,
  ) {
    return this.accounting.reverseEntry(user.orgId, id, dto.reason, user.sub);
  }

  /* ----------------------------------------------------------------------- */
  /*  Reports                                                                 */
  /* ----------------------------------------------------------------------- */

  @Get('trial-balance')
  trialBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.accounting.trialBalance(user.orgId, from, to);
  }

  @Get('profit-loss')
  profitLoss(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.accounting.profitLoss(user.orgId, from, to);
  }

  @Get('balance-sheet')
  balanceSheet(
    @CurrentUser() user: AuthenticatedUser,
    @Query('asOf') asOf?: string,
  ) {
    return this.accounting.balanceSheet(user.orgId, asOf);
  }

  @Get('general-ledger')
  generalLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query('accountId', new ParseUUIDPipe({ optional: true })) accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.accounting.generalLedger(user.orgId, { accountId, from, to, limit });
  }
}