import { Module } from '@nestjs/common';
import { EtimsClient } from './etims.client.js';
import { EtimsService } from './etims.service.js';
import { EtimsController } from './etims.controller.js';
import { EtimsHandlerRegistrar } from './etims.submit-handler.js';

@Module({
  controllers: [EtimsController],
  providers: [EtimsClient, EtimsService, EtimsHandlerRegistrar],
  exports: [EtimsService],
})
export class EtimsModule {}