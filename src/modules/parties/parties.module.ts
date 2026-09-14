import { Module } from '@nestjs/common';
import { PartiesService } from './parties.service.js';
import { PartiesController } from './parties.controller.js';

@Module({
  providers: [PartiesService],
  controllers: [PartiesController],
  exports: [PartiesService],
})
export class PartiesModule {}