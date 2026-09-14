import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PartyStatus, PartyType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreatePartyDto } from './dto/party.dto.js';

const PARTY_SAFE_FIELDS = {
  id: true,
  type: true,
  name: true,
  email: true,
  phone: true,
  taxId: true,
  website: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  creditLimit: true,
  paymentTermsDays: true,
  notes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PartiesService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    organizationId: string,
    limit: number,
    cursor?: string,
    search?: string,
    type?: PartyType,
    status?: PartyStatus,
  ) {
    return this.prisma.client.party.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { taxId: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
      },
      select: PARTY_SAFE_FIELDS,
      take: Math.min(limit, 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { name: 'asc' },
    });
  }

  async findOne(organizationId: string, partyId: string) {
    const party = await this.prisma.client.party.findFirst({
      where: { id: partyId, organizationId },
      select: PARTY_SAFE_FIELDS,
    });
    if (!party) throw new NotFoundException('Party not found');
    return party;
  }

  async create(organizationId: string, dto: CreatePartyDto) {
    if (dto.taxId) {
      const dup = await this.prisma.client.party.findFirst({
        where: { organizationId, taxId: dto.taxId.toUpperCase() },
        select: { id: true },
      });
      if (dup) throw new ConflictException('A party with this KRA PIN already exists');
    }

    const party = await this.prisma.client.party.create({
      data: {
        organizationId,
        type: dto.type,
        name: dto.name,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        taxId: dto.taxId ? dto.taxId.toUpperCase() : null,
        website: dto.website ?? null,
        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        country: dto.country ?? 'KE',
        postalCode: dto.postalCode ?? null,
        creditLimit: dto.creditLimit ?? null,
        paymentTermsDays: dto.paymentTermsDays ?? 30,
        notes: dto.notes ?? null,
        status: dto.status ?? 'ACTIVE',
      },
      select: PARTY_SAFE_FIELDS,
    });
    return party;
  }

  async update(organizationId: string, partyId: string, dto: Partial<CreatePartyDto>) {
    await this.findOne(organizationId, partyId);

    if (dto.taxId) {
      const dup = await this.prisma.client.party.findFirst({
        where: { organizationId, taxId: dto.taxId.toUpperCase(), id: { not: partyId } },
        select: { id: true },
      });
      if (dup) throw new ConflictException('A party with this KRA PIN already exists');
    }

    return this.prisma.client.party.update({
      where: { id: partyId },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.taxId !== undefined
          ? { taxId: dto.taxId ? dto.taxId.toUpperCase() : null }
          : {}),
        ...(dto.website !== undefined ? { website: dto.website } : {}),
        ...(dto.addressLine1 !== undefined ? { addressLine1: dto.addressLine1 } : {}),
        ...(dto.addressLine2 !== undefined ? { addressLine2: dto.addressLine2 } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.country !== undefined ? { country: dto.country } : {}),
        ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode } : {}),
        ...(dto.creditLimit !== undefined ? { creditLimit: dto.creditLimit } : {}),
        ...(dto.paymentTermsDays !== undefined
          ? { paymentTermsDays: dto.paymentTermsDays }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      select: PARTY_SAFE_FIELDS,
    });
  }

  async remove(organizationId: string, partyId: string): Promise<void> {
    await this.findOne(organizationId, partyId);
    await this.prisma.client.party.update({
      where: { id: partyId },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }
}