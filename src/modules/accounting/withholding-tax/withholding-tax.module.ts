import { Module } from '@nestjs/common';
import { WithholdingTaxService } from './withholding-tax.service.js';
import { WithholdingTaxController } from './withholding-tax.controller.js';

@Module({
  controllers: [WithholdingTaxController],
  providers: [WithholdingTaxService],
  exports: [WithholdingTaxService],
})
export class WithholdingTaxModule {}