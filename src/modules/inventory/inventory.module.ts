import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { ItemsController } from './items.controller.js';
import { StockController } from './stock.controller.js';
import { ItemCategoriesController, UnitsOfMeasureController } from './reference.controller.js';

@Module({
  providers: [InventoryService],
  controllers: [
    ItemCategoriesController,
    UnitsOfMeasureController,
    ItemsController,
    StockController,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}