import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { Audit } from '../../common/decorators/audit.decorator.js';
import { UsersService } from './users.service.js';
import { AdminUpdateUserDto, UpdateProfileDto } from './dto/update-user.dto.js';
import { CreateMemberDto } from './dto/create-member.dto.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('cursor') cursor?: string,
  ) {
    this.require(user);
    return this.users.list(user.orgId, limit, cursor);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    this.require(user);
    return this.users.findOne(user.orgId, user.sub);
  }

  @Post()
  @Roles(Role.ADMIN)
  @Audit('User')
  createMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMemberDto,
  ) {
    this.require(user);
    return this.users.createMember(user.orgId, dto);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    return this.users.findOne(user.orgId, id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    this.require(user);
    return this.users.updateProfile(user.sub, user.orgId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @Audit('User')
  adminUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    this.require(user);
    return this.users.adminUpdate(user.orgId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @Audit('User')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.require(user);
    if (user.sub === id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    await this.users.remove(user.orgId, id, user.role as Role);
  }

  private require(user: AuthenticatedUser | undefined): asserts user is AuthenticatedUser {
    if (!user) throw new BadRequestException('Not authenticated');
  }
}