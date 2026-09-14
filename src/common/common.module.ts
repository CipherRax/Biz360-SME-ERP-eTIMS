import { Module } from '@nestjs/common';
import { FallbackController } from './controllers/fallback.controller.js';

@Module({
  controllers: [FallbackController],
})
export class CommonModule {}