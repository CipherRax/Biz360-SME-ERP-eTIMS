import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreditNoteStatus, Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CreditNotesService } from './credit-notes.service.js';
import {
  CreateCreditNoteDto,
  IssueCreditNoteDto,
} from './dto/credit-note.dto.js';

@ApiTags('credit-notes')
@ApiBearerAuth()
@Controller('credit-notes')
export class CreditNotesController {
  constructor(private readonly creditNotes: CreditNotesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(CreditNoteStatus, { optional: true })) status?: string,
    @Query('partyId', new ParseUUIDPipe({ optional: true })) partyId?: string,
  ) {
    return this.creditNotes.list(user.orgId, limit, cursor, search, status, partyId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.creditNotes.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('CreditNote')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCreditNoteDto) {
    return this.creditNotes.createDraft(user.orgId, dto, user.sub);
  }

  @Post(':id/issue')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('CreditNote')
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueCreditNoteDto,
  ) {
    return this.creditNotes.issue(user.orgId, id, dto, user.sub);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  @Audit('CreditNote')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.creditNotes.cancel(user.orgId, id, user.sub);
  }
}