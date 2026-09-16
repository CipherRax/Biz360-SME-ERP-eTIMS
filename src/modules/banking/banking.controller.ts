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
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BankAccountType, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { BankingService } from './banking.service.js';
import {
  CreateBankAccountDto,
  ImportStatementDto,
  ReconcileDto,
  UpdateBankAccountDto,
} from './dto/banking.dto.js';

const BANKING_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

@ApiTags('banking')
@ApiBearerAuth()
@Controller('bank-accounts')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  private require(
    user: AuthenticatedUser | undefined,
  ): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  /* ----------------------------------------------------------------------- */
  /*  Bank accounts                                                           */
  /* ----------------------------------------------------------------------- */

  @Get()
  @Roles(...BANKING_ROLES)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('type', new ParseEnumPipe(BankAccountType, { optional: true }))
    type?: BankAccountType,
  ) {
    this.require(user);
    return this.banking.listAccounts(user.orgId, { limit, cursor, search, type });
  }

  @Get(':id')
  @Roles(...BANKING_ROLES)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    return this.banking.accountDetail(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @Audit('BankAccount')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBankAccountDto) {
    this.require(user);
    return this.banking.createAccount(user.orgId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @Audit('BankAccount')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    this.require(user);
    return this.banking.updateAccount(user.orgId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @Audit('BankAccount')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    await this.banking.removeAccount(user.orgId, id);
  }

  /* ----------------------------------------------------------------------- */
  /*  Statement lines                                                         */
  /* ----------------------------------------------------------------------- */

  @Get(':id/statement-lines')
  @Roles(...BANKING_ROLES)
  statementLines(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('reconciled', new ParseBoolPipe({ optional: true })) reconciled?: boolean,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.banking.listStatementLines(user.orgId, id, { reconciled, limit, cursor });
  }

  @Post(':id/import-statement')
  @Roles(...BANKING_ROLES)
  @Audit('BankAccount')
  importStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ImportStatementDto,
  ) {
    this.require(user);
    return this.banking.importStatement(user.orgId, id, dto);
  }

  /* ----------------------------------------------------------------------- */
  /*  Reconciliation                                                          */
  /* ----------------------------------------------------------------------- */

  @Post(':id/reconcile')
  @Roles(...BANKING_ROLES)
  @Audit('BankAccount')
  reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReconcileDto,
  ) {
    this.require(user);
    return this.banking.reconcile(user.orgId, id, dto, user.sub);
  }

  @Get(':id/reconciliations')
  @Roles(...BANKING_ROLES)
  reconciliations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.banking.listReconciliations(user.orgId, id, { limit, cursor });
  }
}