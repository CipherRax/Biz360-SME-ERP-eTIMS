import {
  Body,
  Controller,
  Get,
  Patch,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { OrganizationsService } from './organizations.service.js';
import { UpdateOrganizationDto, UpdateOrganizationSettingsDto } from './dto/update-organization.dto.js';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.orgs.profile(user.orgId);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.orgs.settings(user.orgId);
  }

  @Patch('me')
  @Roles(Role.ADMIN)
  @Audit('Organization')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOrganizationDto,
  ) {
    this.require(user);
    return this.orgs.updateProfile(user.orgId, dto, user.sub);
  }

  @Patch('settings')
  @Roles(Role.ADMIN)
  @Audit('OrganizationSetting')
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOrganizationSettingsDto,
  ) {
    this.require(user);
    return this.orgs.updateSettings(user.orgId, dto);
  }

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }
}