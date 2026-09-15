import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UpdateOrganizationDto, UpdateOrganizationSettingsDto } from './dto/update-organization.dto.js';

/**
 * Tenant profile + settings. Org settings control the tax rate, currency and
 * invoice numbering used by the sales/purchasing confirm flows.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(orgId: string) {
    const org = await this.prisma.client.organization.findFirst({
      where: { id: orgId },
      include: { settings: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateProfile(orgId: string, dto: UpdateOrganizationDto, userId: string) {
    const org = await this.prisma.client.organization.findFirst({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const data = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.taxPin !== undefined ? { taxPin: dto.taxPin || null } : {}),
      ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail || null } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone || null } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
    };

    // Not persisted as an entity row yet, but keep the audit signal consistent.
    void userId;

    return this.prisma.client.organization.update({
      where: { id: orgId },
      data,
      include: { settings: true },
    });
  }

  async settings(orgId: string) {
    const setting = await this.prisma.client.organizationSetting.findFirst({
      where: { organizationId: orgId },
    });
    if (!setting) {
      throw new BadRequestException(
        'Organization settings have not been initialized; migration required',
      );
    }
    return setting;
  }

  async updateSettings(orgId: string, dto: UpdateOrganizationSettingsDto) {
    await this.settings(orgId);
    const data = {
      ...(dto.taxRate ? { taxRate: dto.taxRate } : {}),
      ...(dto.currency ? { currency: dto.currency } : {}),
      ...(dto.invoiceNumberFormat ? { invoiceNumberFormat: dto.invoiceNumberFormat } : {}),
      ...(dto.defaultPaymentTermsDays
        ? { defaultPaymentTermsDays: Number(dto.defaultPaymentTermsDays) }
        : {}),
      ...(dto.financialYearStart ? { financialYearStart: dto.financialYearStart } : {}),
    };
    return this.prisma.client.organizationSetting.update({
      where: { organizationId: orgId },
      data,
    });
  }
}