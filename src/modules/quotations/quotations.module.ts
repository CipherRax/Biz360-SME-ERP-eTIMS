import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsService } from './quotations.service.js';

@Module({
  imports: [AccountingModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}