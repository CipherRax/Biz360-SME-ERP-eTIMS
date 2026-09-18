import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { ComplianceModule } from '../compliance/compliance.module.js';
import { PurchasingController } from './purchasing.controller.js';
import { PurchasingService } from './purchasing.service.js';

@Module({
  imports: [AccountingModule, ComplianceModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}