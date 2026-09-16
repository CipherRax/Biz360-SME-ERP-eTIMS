import { Module } from '@nestjs/common';
import { BankingService } from './banking.service.js';
import { BankingController } from './banking.controller.js';

@Module({
  providers: [BankingService],
  controllers: [BankingController],
  exports: [BankingService],
})
export class BankingModule {}