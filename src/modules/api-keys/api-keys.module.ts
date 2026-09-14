import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service.js';
import { ApiKeysController } from './api-keys.controller.js';

@Module({
  providers: [ApiKeysService],
  controllers: [ApiKeysController],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}