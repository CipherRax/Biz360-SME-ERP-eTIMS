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
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';

@ApiTags('api-keys')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }

  @ApiBearerAuth()
  @Post()
  @Roles(Role.ADMIN)
  @Audit('ApiKey')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateApiKeyDto) {
    this.require(user);
    return this.apiKeys.create(user.orgId, dto);
  }

  @ApiBearerAuth()
  @Get()
  @Roles(Role.ADMIN)
  list(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.apiKeys.list(user.orgId);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @Roles(Role.ADMIN)
  @Audit('ApiKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    await this.apiKeys.revoke(user.orgId, id);
  }
}