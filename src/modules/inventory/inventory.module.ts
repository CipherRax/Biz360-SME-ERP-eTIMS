import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { ItemsController } from './items.controller.js';
import { ItemCategoriesController, UnitsOfMeasureController } from './reference.controller.js';

@Module({
  providers: [InventoryService],
  controllers: [
    ItemCategoriesController,
    UnitsOfMeasureController,
    ItemsController,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}