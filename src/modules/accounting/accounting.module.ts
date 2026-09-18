import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { LedgerService } from './ledger.service.js';
import { WithholdingTaxModule } from './withholding-tax/withholding-tax.module.js';

@Module({
  imports: [WithholdingTaxModule],
  controllers: [AccountingController],
  providers: [AccountingService, LedgerService],
  exports: [LedgerService],
})
export class AccountingModule {}