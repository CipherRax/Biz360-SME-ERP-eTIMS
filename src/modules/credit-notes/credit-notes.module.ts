import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { CreditNotesService } from './credit-notes.service.js';
import { CreditNotesController } from './credit-notes.controller.js';

@Module({
  imports: [AccountingModule],
  providers: [CreditNotesService],
  controllers: [CreditNotesController],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}