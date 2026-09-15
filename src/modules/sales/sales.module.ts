import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { SalesService } from './sales.service.js';
import { SalesController } from './sales.controller.js';

@Module({
  imports: [AccountingModule],
  providers: [SalesService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}