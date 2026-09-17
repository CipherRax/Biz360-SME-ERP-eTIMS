-- The initial in-flight dedupe index was keyed on
-- (organizationId, aggregateType, aggregateId) without eventType. That conflated
-- distinct event types targeting the same aggregate — e.g. an invoice submit and
-- a credit-note submit for the same invoice would collide while both are
-- PENDING/PROCESSING. Recreate the partial unique index with eventType included
-- so each event type dedupes independently.
DROP INDEX "outbox_events_inflight_aggregate_unique";

CREATE UNIQUE INDEX "outbox_events_inflight_aggregate_unique"
  ON "outbox_events"("organizationId", "aggregateType", "aggregateId", "eventType")
  WHERE "status" IN ('PENDING', 'PROCESSING');