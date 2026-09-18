import { Module } from '@nestjs/common';
import { SupplierEtimsService } from './supplier-etims/supplier-etims.service.js';
import {
  SupplierEtimsController,
  ExpenseExposureController,
} from './supplier-etims/supplier-etims.controller.js';
import { SupplierEtimsHandlerRegistrar } from './supplier-etims/supplier-etims.handler.js';
import { ExpenseComplianceService } from './expense-matching/expense-compliance.service.js';

@Module({
  controllers: [SupplierEtimsController, ExpenseExposureController],
  providers: [SupplierEtimsService, SupplierEtimsHandlerRegistrar, ExpenseComplianceService],
  exports: [ExpenseComplianceService],
})
export class ComplianceModule {}