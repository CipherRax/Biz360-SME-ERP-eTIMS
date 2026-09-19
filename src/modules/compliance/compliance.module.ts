import { Module } from '@nestjs/common';
import { SupplierEtimsService } from './supplier-etims/supplier-etims.service.js';
import {
  SupplierEtimsController,
  ExpenseExposureController,
  SupplierEtimsCreditController,
} from './supplier-etims/supplier-etims.controller.js';
import { SupplierEtimsHandlerRegistrar } from './supplier-etims/supplier-etims.handler.js';
import { ExpenseComplianceService } from './expense-matching/expense-compliance.service.js';
import { EtimsDriftService } from './supplier-etims/etims-drift.service.js';
import {
  OcrProvider,
  MockOcrProvider,
  HttpOcrProvider,
} from './providers/ocr.provider.js';
import {
  KraVerificationProvider,
  MockKraVerificationProvider,
  HttpKraVerificationProvider,
} from './providers/kra-verification.provider.js';

const ocrProvider = {
  provide: 'OcrProvider',
  useFactory: (): OcrProvider => {
    const url = process.env.OCR_PROVIDER_URL;
    if (url) return new HttpOcrProvider(url);
    return new MockOcrProvider();
  },
};

const kraVerificationProvider = {
  provide: 'KraVerificationProvider',
  useFactory: (): KraVerificationProvider => {
    const url = process.env.KRA_PIN_VERIFY_URL;
    if (url) return new HttpKraVerificationProvider(url);
    return new MockKraVerificationProvider();
  },
};

@Module({
  controllers: [
    SupplierEtimsController,
    ExpenseExposureController,
    SupplierEtimsCreditController,
  ],
  providers: [
    SupplierEtimsService,
    SupplierEtimsHandlerRegistrar,
    ExpenseComplianceService,
    EtimsDriftService,
    ocrProvider,
    kraVerificationProvider,
  ],
  exports: [ExpenseComplianceService],
})
export class ComplianceModule {}