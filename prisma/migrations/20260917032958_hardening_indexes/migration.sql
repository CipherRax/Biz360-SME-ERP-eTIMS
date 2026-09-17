-- CreateIndex
CREATE INDEX "email_verification_tokens_organizationId_idx" ON "email_verification_tokens"("organizationId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_organizationId_idx" ON "password_reset_tokens"("organizationId");

-- Outbox in-flight dedupe: at most one PENDING/PROCESSING event per
-- (organizationId, aggregateType, aggregateId). Prevents double submission to
-- KRA when the eTIMS trigger is raced by concurrent requests. Completed/failed
-- rows are unaffected. (Partial index — expressed only in this migration as
-- Prisma's schema DSL has no partial-index support; it is managed manually.)
CREATE UNIQUE INDEX "outbox_events_inflight_aggregate_unique"
  ON "outbox_events"("organizationId", "aggregateType", "aggregateId")
  WHERE "status" IN ('PENDING', 'PROCESSING');
