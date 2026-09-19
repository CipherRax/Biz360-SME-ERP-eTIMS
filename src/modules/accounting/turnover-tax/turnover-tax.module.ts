import { Module } from '@nestjs/common';
import { TurnoverTaxService } from './turnover-tax.service.js';
import { TotController, TaxProfileController } from './turnover-tax.controller.js';
import { TotPaymentHandlerRegistrar } from './turnover-tax.handler.js';
import {
  HttpMobileMoneyProvider,
  MockMobileMoneyProvider,
} from '../../payments/mobile-money/mobile-money.provider.js';

const mobileMoneyProvider = {
  provide: 'MobileMoneyProvider',
  useFactory: () => {
    const url = process.env.DARAJA_BASE_URL ?? process.env.MOBILE_MONEY_BASE_URL;
    if (url) return new HttpMobileMoneyProvider('MPESA', url, process.env.DARAJA_API_KEY);
    return new MockMobileMoneyProvider('MPESA');
  },
};

@Module({
  controllers: [TaxProfileController, TotController],
  providers: [TurnoverTaxService, TotPaymentHandlerRegistrar, mobileMoneyProvider],
  exports: [TurnoverTaxService],
})
export class TurnoverTaxModule {}