import { Module } from '@nestjs/common';
import { GoodsReceiptsController } from './goods-receipts.controller.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';

@Module({
  controllers: [GoodsReceiptsController],
  providers: [GoodsReceiptsService],
  exports: [GoodsReceiptsService],
})
export class GoodsReceiptsModule {}
