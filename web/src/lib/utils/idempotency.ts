// Client-generated idempotency key for financial mutations. Paired with the
// backend's 24h Idempotency-Key cache so a double-click or retried request
// cannot create two invoices/payments/journal entries.
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}