import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox/outbox.service.js';
import { OutboxDispatcher } from './outbox/outbox.dispatcher.js';
import { OutboxWorker } from './outbox/outbox.worker.js';
import { NotificationHandlerRegistrar } from './handlers/notification.handler.js';

/**
 * Holds the outbox machinery: enqueue (transactional), dispatch (handler
 * registry) and the polling worker. @Global so any module can enqueue events.
 */
@Global()
@Module({
  providers: [
    OutboxService,
    OutboxDispatcher,
    OutboxWorker,
    NotificationHandlerRegistrar,
  ],
  exports: [OutboxService, OutboxDispatcher],
})
export class EventsModule {}