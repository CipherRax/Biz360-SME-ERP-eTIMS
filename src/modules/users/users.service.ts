import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  Role,
  UserStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AdminUpdateUserDto, UpdateProfileDto } from './dto/update-user.dto.js';
import { CreateMemberDto } from './dto/create-member.dto.js';

const SAFE_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  preferences: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  /**
   * Admin provisioning of a member into the caller's organization.
   * Directly activated (this is not the self-service invite flow).
   */
  async createMember(organizationId: string, dto: CreateMemberDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.client.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.password.hash(dto.password);
    const user = await this.prisma.client.user.create({
      data: {
        organizationId,
        email,
        name: dto.name,
        passwordHash,
        role: dto.role ?? Role.STAFF,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        preferences: { language: 'en', timezone: 'Africa/Nairobi' },
      },
      select: SAFE_USER_FIELDS,
    });
    return user;
  }

  list(organizationId: string, limit: number, cursor?: string) {
    return this.prisma.client.user.findMany({
      where: { organizationId },
      select: SAFE_USER_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, userId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, organizationId },
      select: SAFE_USER_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(
    actorId: string,
    organizationId: string,
    dto: UpdateProfileDto,
  ) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: actorId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.client.user.update({
      where: { id: actorId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.preferences !== undefined
          ? { preferences: dto.preferences as Prisma.InputJsonValue }
          : {}),
      },
      select: SAFE_USER_FIELDS,
    });
  }

  /**
   * Admin-only: change a user's role or status. Audited — changing a role is
   * a sensitive, compliance-relevant action.
   */
  async adminUpdate(
    organizationId: string,
    targetUserId: string,
    dto: AdminUpdateUserDto,
  ) {
    const target = await this.prisma.client.user.findFirst({
      where: { id: targetUserId, organizationId },
    });
    if (!target) throw new NotFoundException('User not found');

    const data: { role?: Role; status?: UserStatus } = {};
    if (dto.role) data.role = dto.role;

    return this.prisma.client.user.update({
      where: { id: targetUserId },
      data,
      select: SAFE_USER_FIELDS,
    });
  }

  async remove(
    organizationId: string,
    targetUserId: string,
    actorRole: Role,
  ): Promise<void> {
    const target = await this.prisma.client.user.findFirst({
      where: { id: targetUserId, organizationId },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === Role.ADMIN && actorRole !== Role.ADMIN) {
      throw new NotFoundException('User not found');
    }

    // Logical delete: stamp deletedAt explicitly. The extension protects this
    // update from targeting an already-soft-deleted row and keeps the rest of
    // the read/mutate surface away from deleted rows.
    await this.prisma.client.user.update({
      where: { id: targetUserId },
      data: { deletedAt: new Date() },
    });
    await this.prisma.client.refreshToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}