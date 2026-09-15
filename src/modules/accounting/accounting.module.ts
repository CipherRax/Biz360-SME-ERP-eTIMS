import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { LedgerService } from './ledger.service.js';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, LedgerService],
  exports: [LedgerService],
})
export class AccountingModule {}