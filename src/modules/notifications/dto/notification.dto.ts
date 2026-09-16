import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  NotificationStatus,
  NotificationType,
  Prisma,
} from '../../../generated/prisma/client.js';

/**
 * Payload for creating a notification (used internally by other services such
 * as sales, purchasing and inventory, since notifications are never created
 * bidirectionally through the REST API).
 */
export class CreateNotificationDto {
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  referenceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  referenceId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Prisma.InputJsonValue;
}

/** Partial update of a notification (status changes, re-flow, etc.). */
export class UpdateNotificationDto {
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsObject()
  metadata?: Prisma.InputJsonValue;
}